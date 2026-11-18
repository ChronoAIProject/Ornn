/**
 * HTTP client for chrono-storage service.
 * All file operations go through this client instead of direct S3 access.
 * @module clients/storageClient
 */

import { createLogger } from "../shared/logger";
import { requestWithSaToken, type SaTokenSource } from "./nyxid/saRequest";
import { safeFetch } from "../infra/safeFetch";
const logger = createLogger("storageClient");

export interface IStorageClient {
  upload(bucket: string, key: string, data: Uint8Array, contentType: string): Promise<{ url: string }>;
  delete(bucket: string, key: string): Promise<void>;
  /**
   * Stream an object's raw bytes from chrono-bucket's
   * `GET /api/buckets/:bucket/objects/download?key=` endpoint. Replaces the
   * removed presigned-URL flow (#1196): chrono-bucket no longer hands out
   * direct S3 URLs, so every read is proxied through this client instead of a
   * client fetching MinIO directly.
   */
  downloadObject(
    bucket: string,
    key: string,
  ): Promise<{ bytes: Uint8Array; contentType: string; contentLength?: number }>;
}

/**
 * Runtime-resolvable Chrono Storage config. Sourced from admin settings
 * (`services` section) — the ConfigMap-baked URL and bucket are gone.
 */
export interface StorageClientConfig {
  baseUrl: string;
  /** Default bucket name. Empty string is rejected at admin-save time. */
  bucket: string;
}

export type StorageClientConfigResolver = () => Promise<StorageClientConfig>;

export class StorageClient implements IStorageClient {
  private readonly resolver: StorageClientConfigResolver;
  // exactOptionalPropertyTypes (#657): widen to `T | undefined`.
  private readonly getAccessToken: (() => Promise<string>) | undefined;

  private readonly saTokenProvider: SaTokenSource | undefined;

  constructor(opts: {
    resolver: StorageClientConfigResolver;
    getAccessToken?: () => Promise<string>;
    saTokenProvider?: SaTokenSource;
  }) {
    this.resolver = opts.resolver;
    this.getAccessToken = opts.getAccessToken;
    this.saTokenProvider = opts.saTokenProvider;
    logger.info({ authenticated: !!(opts.saTokenProvider || opts.getAccessToken) }, "StorageClient initialized");
  }

  private async resolveBaseUrl(): Promise<string> {
    const cfg = await this.resolver();
    return cfg.baseUrl.replace(/\/+$/, "");
  }

  async getDefaultBucket(): Promise<string> {
    const cfg = await this.resolver();
    return cfg.bucket;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const send = async (token: string) => {
      const baseUrl = await this.resolveBaseUrl();
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return safeFetch(`${baseUrl}${path}`, { ...init, headers });
    };
    return this.saTokenProvider
      ? requestWithSaToken(this.saTokenProvider, send)
      : send(this.getAccessToken ? await this.getAccessToken() : "");
  }

  async upload(
    bucket: string,
    key: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<{ url: string }> {
    const params = new URLSearchParams({ key, contentType });
    const url = `/api/buckets/${bucket}/objects?${params.toString()}`;

    const res = await this.request(url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: data as unknown as BodyInit,
    });

    if (!res.ok) {
      const text = res.status === 401 || res.status === 403
        ? "authentication rejected" : await res.text().catch(() => "");
      logger.error({ status: res.status, bucket, key }, "Storage upload failed");
      throw new Error(`Storage upload failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as { data: { url: string } };
    logger.debug({ bucket, key }, "File uploaded to storage");
    return { url: json.data.url };
  }

  async delete(bucket: string, key: string): Promise<void> {
    const params = new URLSearchParams({ key });
    const url = `/api/buckets/${bucket}/objects?${params.toString()}`;

    const res = await this.request(url, { method: "DELETE" });

    if (!res.ok) {
      const text = res.status === 401 || res.status === 403
        ? "authentication rejected" : await res.text().catch(() => "");
      logger.error({ status: res.status, bucket, key }, "Storage delete failed");
      throw new Error(`Storage delete failed (${res.status}): ${text}`);
    }

    logger.debug({ bucket, key }, "File deleted from storage");
  }

  async downloadObject(
    bucket: string,
    key: string,
  ): Promise<{ bytes: Uint8Array; contentType: string; contentLength?: number }> {
    const params = new URLSearchParams({ key });
    const url = `/api/buckets/${bucket}/objects/download?${params.toString()}`;

    const res = await this.request(url, { method: "GET" });

    if (!res.ok) {
      const text = res.status === 401 || res.status === 403
        ? "authentication rejected" : await res.text().catch(() => "");
      logger.error({ status: res.status, bucket, key }, "Storage download failed");
      throw new Error(`Storage download failed (${res.status}): ${text}`);
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const lenHeader = res.headers.get("content-length");
    const contentLength = lenHeader !== null ? Number(lenHeader) : NaN;
    logger.debug({ bucket, key, bytes: bytes.byteLength }, "File downloaded from storage");

    // exactOptionalPropertyTypes (#657): only attach contentLength when the
    // header was present and numeric — never assign an explicit `undefined`.
    return Number.isFinite(contentLength)
      ? { bytes, contentType, contentLength }
      : { bytes, contentType };
  }
}
