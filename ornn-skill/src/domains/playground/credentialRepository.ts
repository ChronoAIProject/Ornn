/**
 * SQLite repository for playground credential storage.
 * Operations are synchronous (bun:sqlite best practice).
 * Merged from ornn-playground.
 * @module domains/playground/credentialRepository
 */

import type { Database } from "bun:sqlite";
import type { PlaygroundCredential, PlaygroundCredentialMeta } from "../../shared/types/index";
import { randomUUID } from "node:crypto";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "credentialRepository" });

export interface CreateCredentialData {
  userId: string;
  name: string;
  encryptedValue: string;
}

interface DbRow {
  id: string;
  user_id: string;
  name: string;
  encrypted_value: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DbRow): PlaygroundCredential {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    encryptedValue: row.encrypted_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMeta(row: DbRow): PlaygroundCredentialMeta {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

export class CredentialRepository {
  constructor(private readonly db: Database) {
    logger.info("CredentialRepository initialized");
  }

  findByUserId(userId: string): PlaygroundCredentialMeta[] {
    const stmt = this.db.prepare(
      "SELECT id, name, created_at, updated_at FROM playground_credentials WHERE user_id = ? ORDER BY name ASC",
    );
    return (stmt.all(userId) as DbRow[]).map(toMeta);
  }

  findByUserIdAndName(userId: string, name: string): PlaygroundCredential | null {
    const stmt = this.db.prepare(
      "SELECT * FROM playground_credentials WHERE user_id = ? AND name = ?",
    );
    const row = stmt.get(userId, name) as DbRow | null;
    return row ? mapRow(row) : null;
  }

  findById(id: string): PlaygroundCredential | null {
    const stmt = this.db.prepare("SELECT * FROM playground_credentials WHERE id = ?");
    const row = stmt.get(id) as DbRow | null;
    return row ? mapRow(row) : null;
  }

  create(data: CreateCredentialData): PlaygroundCredential {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO playground_credentials (id, user_id, name, encrypted_value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, data.userId, data.name, data.encryptedValue, now, now);

    logger.debug({ id, userId: data.userId, name: data.name }, "Credential created");
    return {
      id,
      userId: data.userId,
      name: data.name,
      encryptedValue: data.encryptedValue,
      createdAt: now,
      updatedAt: now,
    };
  }

  update(id: string, encryptedValue: string): PlaygroundCredential | null {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      "UPDATE playground_credentials SET encrypted_value = ?, updated_at = ? WHERE id = ?",
    ).run(encryptedValue, now, id);

    if (result.changes === 0) return null;
    logger.debug({ id }, "Credential updated");
    return this.findById(id);
  }

  delete(id: string, userId: string): boolean {
    const result = this.db.prepare(
      "DELETE FROM playground_credentials WHERE id = ? AND user_id = ?",
    ).run(id, userId);
    if (result.changes > 0) {
      logger.debug({ id, userId }, "Credential deleted");
    }
    return result.changes > 0;
  }

  getEncryptedValues(userId: string, names: string[]): PlaygroundCredential[] {
    if (names.length === 0) {
      const stmt = this.db.prepare(
        "SELECT * FROM playground_credentials WHERE user_id = ?",
      );
      return (stmt.all(userId) as DbRow[]).map(mapRow);
    }
    const placeholders = names.map(() => "?").join(",");
    const stmt = this.db.prepare(
      `SELECT * FROM playground_credentials WHERE user_id = ? AND name IN (${placeholders})`,
    );
    return (stmt.all(userId, ...names) as DbRow[]).map(mapRow);
  }
}
