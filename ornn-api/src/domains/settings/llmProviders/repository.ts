/**
 * One-doc-per-provider persistence in the `llm_providers` collection
 * (Architecture §3.4). Repository deals exclusively in stored shape —
 * `Enc`-suffixed fields hold ciphertext; the service layer above
 * encrypts on write and decrypts on read.
 *
 * @module domains/settings/llmProviders/repository
 */

import type { Collection, Db, Document } from "mongodb";
import type { ApiFormat, LlmProviderModel } from "./types";

export interface StoredAuth {
  readonly kind: "apiKey" | "tokenUrl" | "basic";
  readonly apiKeyEnc?: string;
  readonly tokenUrl?: string;
  readonly clientId?: string;
  readonly clientSecretEnc?: string;
  readonly username?: string;
  readonly passwordEnc?: string;
}

export interface StoredProvider {
  readonly _id: string;
  readonly name: string;
  readonly gatewayUrl: string;
  readonly modelListUrl: string;
  readonly apiFormat: ApiFormat;
  readonly auth: StoredAuth;
  readonly models: ReadonlyArray<LlmProviderModel>;
  readonly defaultModelId: string | null;
  readonly maxOutputTokens: number;
  readonly defaultTemperature: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}

export class LlmProvidersRepository {
  private readonly collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection("llm_providers");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ name: 1 }, { unique: true });
  }

  async list(): Promise<ReadonlyArray<StoredProvider>> {
    const docs = await this.collection.find({}).sort({ name: 1 }).toArray();
    return docs.map(this.fromDoc);
  }

  async findById(id: string): Promise<StoredProvider | null> {
    const doc = await this.collection.findOne({
      _id: id as unknown as Document["_id"],
    });
    return doc ? this.fromDoc(doc) : null;
  }

  async findByName(name: string): Promise<StoredProvider | null> {
    const doc = await this.collection.findOne({ name });
    return doc ? this.fromDoc(doc) : null;
  }

  async insert(doc: StoredProvider): Promise<void> {
    await this.collection.insertOne(doc as unknown as Document);
  }

  async replace(id: string, doc: StoredProvider): Promise<void> {
    await this.collection.replaceOne(
      { _id: id as unknown as Document["_id"] },
      doc as unknown as Document,
    );
  }

  async deleteById(id: string): Promise<boolean> {
    const res = await this.collection.deleteOne({
      _id: id as unknown as Document["_id"],
    });
    return res.deletedCount === 1;
  }

  private fromDoc(doc: Document): StoredProvider {
    const d = doc as unknown as StoredProvider & { _id: string };
    return {
      _id: d._id,
      name: d.name,
      gatewayUrl: d.gatewayUrl,
      modelListUrl: d.modelListUrl,
      apiFormat: d.apiFormat,
      auth: d.auth,
      models: d.models ?? [],
      defaultModelId: d.defaultModelId ?? null,
      maxOutputTokens: d.maxOutputTokens,
      defaultTemperature: d.defaultTemperature,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      updatedBy: d.updatedBy ?? "system",
    };
  }
}
