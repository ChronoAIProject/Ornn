/**
 * Skill CRUD routes aligned with design spec.
 * - POST /skills — skill-create (ZIP body, authenticated)
 * - GET /skills/:idOrName — skill-read (authenticated)
 * - PUT /skills/:id — skill-update (ZIP body or isPrivate, authenticated)
 * - DELETE /skills/:id — skill-delete (hard delete, authenticated)
 * @module routes/skillRoutes
 */

import { Hono } from "hono";
import type { ISkillService } from "../services/skillService.interface";
import type { TokenVerifier } from "ornn-shared";
import { createAuthMiddleware, getAuth, type AuthVariables, AppError } from "ornn-shared";

export interface SkillRoutesOptions {
  skillService: ISkillService;
  tokenService: TokenVerifier;
  maxFileSize?: number;
}

export function createSkillRoutes(
  skillService: ISkillService,
  tokenService: TokenVerifier,
  maxFileSize: number = 52_428_800,
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  const authMiddleware = createAuthMiddleware(tokenService);

  // All skill CRUD routes require authentication
  app.use("/skills/*", authMiddleware);
  app.use("/skills", authMiddleware);

  /**
   * POST /skills — Create a new skill from a ZIP package.
   * Input: application/zip request body.
   * Response: { data: { guid }, error: null }
   */
  app.post("/skills", async (c) => {
    const auth = getAuth(c);
    const skipValidation = c.req.query("skip_validation") === "true";

    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.includes("application/zip") && !contentType.includes("application/octet-stream")) {
      throw AppError.badRequest("INVALID_CONTENT_TYPE", "Expected application/zip content type");
    }

    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) {
      throw AppError.badRequest("EMPTY_BODY", "Request body is empty");
    }

    if (body.byteLength > maxFileSize) {
      throw AppError.payloadTooLarge("File exceeds maximum upload size");
    }

    const zipBuffer = new Uint8Array(body);
    const result = await skillService.createSkill(zipBuffer, auth.userId, { skipValidation });

    // Return full skill detail so the frontend can display name, navigate, etc.
    const skill = await skillService.getSkill(result.guid);
    return c.json({ data: skill, error: null });
  });

  /**
   * GET /skills/:idOrName — Read a skill by GUID or name.
   * Response: { data: { ...skillDetail }, error: null }
   */
  app.get("/skills/:idOrName", async (c) => {
    const idOrName = c.req.param("idOrName");
    const skill = await skillService.getSkill(idOrName);
    return c.json({ data: skill, error: null });
  });

  /**
   * PUT /skills/:id — Update a skill.
   * May contain:
   * - application/zip body to update the package
   * - JSON body with { isPrivate: boolean } to toggle visibility
   * - multipart with both
   * Response: same schema as skill-read
   */
  app.put("/skills/:id", async (c) => {
    const guid = c.req.param("id");
    const auth = getAuth(c);
    const contentType = c.req.header("content-type") ?? "";
    const skipValidation = c.req.query("skip_validation") === "true";

    let zipBuffer: Uint8Array | undefined;
    let isPrivate: boolean | undefined;

    if (contentType.includes("application/zip") || contentType.includes("application/octet-stream")) {
      // Pure ZIP upload
      const body = await c.req.arrayBuffer();
      if (body && body.byteLength > 0) {
        if (body.byteLength > maxFileSize) {
          throw AppError.payloadTooLarge("File exceeds maximum upload size");
        }
        zipBuffer = new Uint8Array(body);
      }
    } else if (contentType.includes("multipart/form-data")) {
      // Multipart: may contain package (file) and isPrivate (field)
      const formData = await c.req.parseBody({ all: true });
      const packageFile = formData["package"];
      if (packageFile instanceof File) {
        if (packageFile.size > maxFileSize) {
          throw AppError.payloadTooLarge("File exceeds maximum upload size");
        }
        const buf = await packageFile.arrayBuffer();
        zipBuffer = new Uint8Array(buf);
      }
      if (formData["isPrivate"] !== undefined) {
        const val = String(formData["isPrivate"]);
        isPrivate = val === "true";
      }
    } else if (contentType.includes("application/json")) {
      // JSON body for isPrivate toggle
      const body = await c.req.json();
      if (body.isPrivate !== undefined) {
        isPrivate = Boolean(body.isPrivate);
      }
    }

    if (zipBuffer === undefined && isPrivate === undefined) {
      throw AppError.badRequest("NO_UPDATE", "No update data provided. Send a ZIP file and/or isPrivate field.");
    }

    const result = await skillService.updateSkill(guid, auth.userId, { zipBuffer, isPrivate, skipValidation });
    return c.json({ data: result, error: null });
  });

  /**
   * DELETE /skills/:id — Hard-delete a skill.
   * Response: { data: { success: true }, error: null } with status 200
   */
  app.delete("/skills/:id", async (c) => {
    const guid = c.req.param("id");
    await skillService.deleteSkill(guid);
    return c.json({ data: { success: true }, error: null });
  });

  return app;
}
