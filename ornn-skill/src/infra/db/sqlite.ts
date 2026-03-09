/**
 * SQLite database for playground credential storage.
 * @module infra/db/sqlite
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "sqlite" });

let db: Database | null = null;

export async function initSqlite(dataDir: string): Promise<Database> {
  if (db) return db;

  const dbDir = join(dataDir, "playground");
  await mkdir(dbDir, { recursive: true });

  db = new Database(join(dbDir, "playground.sqlite"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS playground_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_pg_creds_user_id
      ON playground_credentials(user_id);
  `);

  logger.info({ path: join(dbDir, "playground.sqlite") }, "SQLite database initialized");
  return db;
}

export function getSqliteDb(): Database {
  if (!db) {
    throw new Error("SQLite database not initialized. Call initSqlite first.");
  }
  return db;
}

export function closeSqlite(): void {
  if (db) {
    db.close();
    db = null;
    logger.info("SQLite database closed");
  }
}
