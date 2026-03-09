/**
 * AES-256-GCM encryption utilities for credential storage.
 * Inlined from ornn-shared.
 * @module shared/utils/crypto
 */

import { createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";

export function aesEncrypt(plaintext: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error("AES-256 requires a 32-byte key");
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextBytes), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([Buffer.from(iv), authTag, encrypted]);
  return combined.toString("base64");
}

export function aesDecrypt(ciphertext: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error("AES-256 requires a 32-byte key");
  }

  const combined = Buffer.from(ciphertext, "base64");
  if (combined.length < 28) {
    throw new Error("Invalid ciphertext: too short");
  }

  const iv = combined.subarray(0, 12);
  const authTag = combined.subarray(12, 28);
  const encrypted = combined.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf-8");
}

export function deriveKey(
  password: string,
  salt: string,
  iterations: number = 100000,
): Buffer {
  return pbkdf2Sync(password, salt, iterations, 32, "sha256");
}
