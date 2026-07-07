/**
 * HTTP client for chrono-storage service.
 * All file operations go through this client instead of direct S3 access.
 * @module clients/storageClient
 */

import { createLogger } from "../shared/logger";
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

  constructor(opts: {
    resolver: StorageClientConfigResolver;
    getAccessToken?: () => Promise<string>;
  }) {
    this.resolver = opts.resolver;
    this.getAccessToken = opts.getAccessToken;
    logger.info({ authenticated: !!opts.getAccessToken }, "StorageClient initialized");
  }

  private async resolveBaseUrl(): Promise<string> {
    const cfg = await this.resolver();
    return cfg.baseUrl.replace(/\/+$/, "");
  }

  async getDefaultBucket(): Promise<string> {
    const cfg = await this.resolver();
    return cfg.bucket;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (!this.getAccessToken) return {};
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  async upload(
    bucket: string,
    key: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<{ url: string }> {
    const baseUrl = await this.resolveBaseUrl();
    const params = new URLSearchParams({ key, contentType });
    const url = `${baseUrl}/api/buckets/${bucket}/objects?${params.toString()}`;

    const auth = await this.authHeaders();
    const res = await safeFetch(url, {
      method: "POST",
      headers: { "Content-Type": contentType, ...auth },
      body: data as unknown as BodyInit,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error({ status: res.status, bucket, key }, "Storage upload failed");
      throw new Error(`Storage upload failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as { data: { url: string } };
    logger.debug({ bucket, key }, "File uploaded to storage");
    return { url: json.data.url };
  }

  async delete(bucket: string, key: string): Promise<void> {
    const baseUrl = await this.resolveBaseUrl();
    const params = new URLSearchParams({ key });
    const url = `${baseUrl}/api/buckets/${bucket}/objects?${params.toString()}`;

    const auth = await this.authHeaders();
    const res = await safeFetch(url, { method: "DELETE", headers: auth });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error({ status: res.status, bucket, key }, "Storage delete failed");
      throw new Error(`Storage delete failed (${res.status}): ${text}`);
    }

    logger.debug({ bucket, key }, "File deleted from storage");
  }

  async downloadObject(
    bucket: string,
    key: string,
  ): Promise<{ bytes: Uint8Array; contentType: string; contentLength?: number }> {
    const baseUrl = await this.resolveBaseUrl();
    const params = new URLSearchParams({ key });
    const url = `${baseUrl}/api/buckets/${bucket}/objects/download?${params.toString()}`;

    const auth = await this.authHeaders();
    const res = await safeFetch(url, { method: "GET", headers: auth });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
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
