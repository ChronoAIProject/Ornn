/**
 * MongoDB client singleton with retry logic.
 * @module infra/db/mongodb
 */

import { MongoClient, type Db } from "mongodb";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "mongodb" });

export interface MongoConnection {
  client: MongoClient;
  db: Db;
  close(): Promise<void>;
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

export async function connectMongo(uri: string, dbName: string): Promise<MongoConnection> {
  const client = new MongoClient(uri);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      const db = client.db(dbName);
      logger.info({ dbName }, "MongoDB connected");
      return {
        client,
        db,
        close: () => client.close(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ attempt, maxRetries: MAX_RETRIES }, `MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${message}`);
      if (attempt === MAX_RETRIES) {
        throw new Error(`MongoDB connection failed after ${MAX_RETRIES} attempts: ${message}`, { cause: err });
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("MongoDB connection failed");
}
