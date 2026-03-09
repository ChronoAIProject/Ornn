/**
 * Admin service for category and tag management.
 * @module domains/admin/service
 */

import type { CategoryRepository, TagRepository, CategoryRow, TagRow } from "./repository";
import { AppError } from "../../shared/types/index";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "adminService" });

const VALID_CATEGORY_NAMES = ["plain", "tool-based", "runtime-based", "mixed"] as const;

export class AdminService {
  constructor(
    private readonly categoryRepo: CategoryRepository,
    private readonly tagRepo: TagRepository,
  ) {}

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  async listCategories(): Promise<CategoryRow[]> {
    return this.categoryRepo.findAll();
  }

  async createCategory(data: {
    name: string;
    slug: string;
    description: string;
    order?: number;
  }): Promise<CategoryRow> {
    if (!VALID_CATEGORY_NAMES.includes(data.name as any)) {
      throw AppError.badRequest(
        "INVALID_CATEGORY_NAME",
        `Category name must be one of: ${VALID_CATEGORY_NAMES.join(", ")}`,
      );
    }

    const existing = await this.categoryRepo.findByName(data.name);
    if (existing) {
      throw AppError.conflict("CATEGORY_EXISTS", `Category '${data.name}' already exists`);
    }

    const category = await this.categoryRepo.create(data);
    logger.info({ name: data.name }, "Category created by admin");
    return category;
  }

  async updateCategory(
    id: string,
    data: { description?: string; order?: number },
  ): Promise<CategoryRow> {
    const updated = await this.categoryRepo.update(id, data);
    if (!updated) {
      throw AppError.notFound("CATEGORY_NOT_FOUND", "Category not found");
    }
    logger.info({ id }, "Category updated by admin");
    return updated;
  }

  async deleteCategory(id: string): Promise<void> {
    const deleted = await this.categoryRepo.delete(id);
    if (!deleted) {
      throw AppError.notFound("CATEGORY_NOT_FOUND", "Category not found");
    }
    logger.info({ id }, "Category deleted by admin");
  }

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  async listTags(type?: "predefined" | "custom"): Promise<TagRow[]> {
    return this.tagRepo.findAll(type);
  }

  async createTag(name: string): Promise<TagRow> {
    const existing = await this.tagRepo.findByName(name);
    if (existing) {
      throw AppError.conflict("TAG_EXISTS", `Tag '${name}' already exists`);
    }

    const tag = await this.tagRepo.create(name, "predefined");
    logger.info({ name }, "Tag created by admin");
    return tag;
  }

  async deleteTag(id: string): Promise<void> {
    const deleted = await this.tagRepo.delete(id);
    if (!deleted) {
      throw AppError.notFound("TAG_NOT_FOUND", "Tag not found");
    }
    logger.info({ id }, "Tag deleted by admin");
  }
}
