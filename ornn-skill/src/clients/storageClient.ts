/**
 * HTTP client for chrono-storage service.
 * All file operations go through this client instead of direct S3 access.
 * @module clients/storageClient
 */

import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "storageClient" });

export interface IStorageClient {
  upload(bucket: string, key: string, data: Uint8Array, contentType: string): Promise<{ url: string }>;
  delete(bucket: string, key: string): Promise<void>;
  getPresignedUrl(bucket: string, key: string, expiresIn?: number): Promise<{ presignedUrl: string; expiresAt: string }>;
  copy(bucket: string, sourceKey: string, destKey: string): Promise<void>;
}

export class StorageClient implements IStorageClient {
  constructor(private readonly baseUrl: string) {
    logger.info({ baseUrl }, "StorageClient initialized");
  }

  async upload(
    bucket: string,
    key: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<{ url: string }> {
    const params = new URLSearchParams({ key, contentType });
    const url = `${this.baseUrl}/api/buckets/${bucket}/objects?${params.toString()}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": contentType },
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
    const params = new URLSearchParams({ key });
    const url = `${this.baseUrl}/api/buckets/${bucket}/objects?${params.toString()}`;

    const res = await fetch(url, { method: "DELETE" });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error({ status: res.status, bucket, key }, "Storage delete failed");
      throw new Error(`Storage delete failed (${res.status}): ${text}`);
    }

    logger.debug({ bucket, key }, "File deleted from storage");
  }

  async getPresignedUrl(
    bucket: string,
    key: string,
    expiresIn?: number,
  ): Promise<{ presignedUrl: string; expiresAt: string }> {
    const params = new URLSearchParams({ key });
    if (expiresIn !== undefined) {
      params.set("expiresIn", String(expiresIn));
    }
    const url = `${this.baseUrl}/api/buckets/${bucket}/presigned-url?${params.toString()}`;

    const res = await fetch(url, { method: "GET" });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error({ status: res.status, bucket, key }, "Storage presigned URL failed");
      throw new Error(`Storage presigned URL failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as { data: { presignedUrl: string; expiresAt: string } };
    return json.data;
  }

  async copy(bucket: string, sourceKey: string, destKey: string): Promise<void> {
    const url = `${this.baseUrl}/api/buckets/${bucket}/objects/copy`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceKey, destKey }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error({ status: res.status, bucket, sourceKey, destKey }, "Storage copy failed");
      throw new Error(`Storage copy failed (${res.status}): ${text}`);
    }

    logger.debug({ bucket, sourceKey, destKey }, "File copied in storage");
  }
}
