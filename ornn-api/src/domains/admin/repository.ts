/**
 * Admin repositories for category and tag CRUD.
 * Merged from ornn-auth admin domain.
 * @module domains/admin/repository
 */

import type { Collection, Db, Document, ObjectId } from "mongodb";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "adminRepository" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CategoryRow {
  _id: any;
  name: string;
  slug: string;
  description: string;
  order: number;
  skillCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TagRow {
  _id: any;
  name: string;
  type: "predefined" | "custom";
  usageCount: number;
  createdBy: any | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Category Repository
// ---------------------------------------------------------------------------

export class CategoryRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("categories");
    logger.info("CategoryRepository initialized");
  }

  async findById(id: string): Promise<CategoryRow | null> {
    const { ObjectId } = await import("mongodb");
    if (!ObjectId.isValid(id)) return null;
    const doc = await this.collection.findOne({ _id: new ObjectId(id), deletedAt: { $exists: false } });
    return mapCategory(doc);
  }

  async findByName(name: string): Promise<CategoryRow | null> {
    const doc = await this.collection.findOne({ name, deletedAt: { $exists: false } });
    return mapCategory(doc);
  }

  async findAll(): Promise<CategoryRow[]> {
    const docs = await this.collection.find({ deletedAt: { $exists: false } }).sort({ order: 1 }).toArray();
    return docs.map((d) => mapCategory(d)!);
  }

  async create(data: { name: string; slug: string; description: string; order?: number }): Promise<CategoryRow> {
    const now = new Date();
    let order = data.order;
    if (order === undefined) {
      const maxDoc = await this.collection.findOne({ deletedAt: { $exists: false } }, { sort: { order: -1 } });
      order = maxDoc ? (maxDoc.order as number) + 1 : 0;
    }

    const doc = { name: data.name, slug: data.slug, description: data.description, order, skillCount: 0, createdAt: now, updatedAt: now };
    const result = await this.collection.insertOne(doc);
    logger.info({ name: data.name }, "Category created");
    return mapCategory({ ...doc, _id: result.insertedId })!;
  }

  async update(id: string, data: { description?: string; order?: number }): Promise<CategoryRow | null> {
    const { ObjectId } = await import("mongodb");
    if (!ObjectId.isValid(id)) return null;

    const setFields: Record<string, unknown> = { updatedAt: new Date() };
    if (data.description !== undefined) setFields.description = data.description;
    if (data.order !== undefined) setFields.order = data.order;

    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id), deletedAt: { $exists: false } },
      { $set: setFields },
      { returnDocument: "after" },
    );
    logger.info({ id }, "Category updated");
    return mapCategory(result);
  }

  async delete(id: string): Promise<boolean> {
    const { ObjectId } = await import("mongodb");
    if (!ObjectId.isValid(id)) return false;

    const result = await this.collection.updateOne(
      { _id: new ObjectId(id), deletedAt: { $exists: false } },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } },
    );
    if (result.modifiedCount > 0) {
      logger.info({ id }, "Category soft-deleted");
    }
    return result.modifiedCount > 0;
  }
}

// ---------------------------------------------------------------------------
// Tag Repository
// ---------------------------------------------------------------------------

export class TagRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("tags");
    logger.info("TagRepository initialized");
  }

  async findById(id: string): Promise<TagRow | null> {
    const { ObjectId } = await import("mongodb");
    if (!ObjectId.isValid(id)) return null;
    const doc = await this.collection.findOne({ _id: new ObjectId(id) });
    return mapTag(doc);
  }

  async findByName(name: string): Promise<TagRow | null> {
    const doc = await this.collection.findOne({ name: name.toLowerCase().trim() });
    return mapTag(doc);
  }

  async findAll(type?: "predefined" | "custom"): Promise<TagRow[]> {
    const filter: Record<string, unknown> = {};
    if (type) filter.type = type;
    const docs = await this.collection.find(filter).sort({ usageCount: -1, name: 1 }).toArray();
    return docs.map((d) => mapTag(d)!);
  }

  async create(name: string, type: "predefined" | "custom" = "predefined"): Promise<TagRow> {
    const normalizedName = name.toLowerCase().trim();
    const now = new Date();
    const doc = { name: normalizedName, type, usageCount: 0, createdBy: null, createdAt: now };
    const result = await this.collection.insertOne(doc);
    logger.info({ name: normalizedName, type }, "Tag created");
    return mapTag({ ...doc, _id: result.insertedId })!;
  }

  async delete(id: string): Promise<boolean> {
    const { ObjectId } = await import("mongodb");
    if (!ObjectId.isValid(id)) return false;
    const result = await this.collection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount > 0) {
      logger.info({ id }, "Tag deleted");
    }
    return result.deletedCount > 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapCategory(doc: Document | null): CategoryRow | null {
  if (!doc) return null;
  return {
    _id: doc._id,
    name: doc.name as string,
    slug: doc.slug as string,
    description: doc.description as string,
    order: doc.order as number,
    skillCount: doc.skillCount as number,
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}

function mapTag(doc: Document | null): TagRow | null {
  if (!doc) return null;
  return {
    _id: doc._id,
    name: doc.name as string,
    type: doc.type as "predefined" | "custom",
    usageCount: doc.usageCount as number,
    createdBy: doc.createdBy ?? null,
    createdAt: doc.createdAt as Date,
  };
}
