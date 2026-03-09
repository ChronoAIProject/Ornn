/**
 * Playground routes with NyxID auth.
 * Credential CRUD + Chat SSE streaming.
 * LLM Config CRUD removed (now managed by NyxID).
 * @module domains/playground/routes
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { CredentialRepository } from "./credentialRepository";
import type { PlaygroundChatService, PlaygroundChatRequest } from "./chatService";
import {
  type AuthVariables,
  type NyxIDAuthConfig,
  nyxidAuthMiddleware,
  requirePermission,
  getAuth,
  getUserToken,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import type { PlaygroundCredentialMeta } from "../../shared/types/index";
import { aesEncrypt, aesDecrypt, deriveKey } from "../../shared/utils/crypto";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "playgroundRoutes" });

const CREDENTIAL_SALT = "playground-credential-v1";

// Zod schemas
const createCredentialSchema = z.object({
  name: z.string()
    .min(1).max(100)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Name must be alphanumeric with underscores"),
  value: z.string().min(1).max(10_000),
});

const updateCredentialSchema = z.object({
  value: z.string().min(1).max(10_000),
});

const playgroundMessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    args: z.record(z.unknown()),
  })).optional(),
  toolCallId: z.string().optional(),
});

const chatRequestSchema = z.object({
  messages: z.array(playgroundMessageSchema).min(1).max(100),
  skillId: z.string().optional(),
  envVars: z.record(z.string()).optional(),
});

export interface PlaygroundRoutesConfig {
  credentialRepo: CredentialRepository;
  chatService: PlaygroundChatService;
  authConfig: NyxIDAuthConfig;
  platformMasterKey: string;
  keepAliveIntervalMs: number;
}

export function createPlaygroundRoutes(config: PlaygroundRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { credentialRepo, chatService, authConfig, platformMasterKey, keepAliveIntervalMs } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware(authConfig);

  // All playground routes require auth + playground permission
  app.use("/playground/*", auth);

  const getEncryptionKey = (): Buffer => {
    return deriveKey(platformMasterKey, CREDENTIAL_SALT);
  };

  // -------------------------------------------------------------------------
  // Credentials CRUD
  // -------------------------------------------------------------------------

  app.get(
    "/playground/credentials",
    requirePermission("ornn:playground:use"),
    async (c) => {
      const authCtx = getAuth(c);
      const credentials = credentialRepo.findByUserId(authCtx.userId);
      return c.json({ data: credentials, error: null });
    },
  );

  app.post(
    "/playground/credentials",
    requirePermission("ornn:playground:use"),
    async (c) => {
      const authCtx = getAuth(c);
      const body = await c.req.json();
      const parsed = createCredentialSchema.safeParse(body);
      if (!parsed.success) {
        throw AppError.badRequest(
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }

      // Check for duplicate
      const existing = credentialRepo.findByUserIdAndName(authCtx.userId, parsed.data.name);
      if (existing) {
        throw AppError.conflict("CREDENTIAL_EXISTS", `Credential '${parsed.data.name}' already exists`);
      }

      const key = getEncryptionKey();
      const encryptedValue = aesEncrypt(parsed.data.value, key);
      const credential = credentialRepo.create({
        userId: authCtx.userId,
        name: parsed.data.name,
        encryptedValue,
      });

      logger.info({ userId: authCtx.userId, name: parsed.data.name }, "Credential created");

      const meta: PlaygroundCredentialMeta = {
        id: credential.id,
        name: credential.name,
        createdAt: credential.createdAt,
      };
      return c.json({ data: meta, error: null }, 201);
    },
  );

  app.put(
    "/playground/credentials/:id",
    requirePermission("ornn:playground:use"),
    async (c) => {
      const authCtx = getAuth(c);
      const id = c.req.param("id");
      const body = await c.req.json();
      const parsed = updateCredentialSchema.safeParse(body);
      if (!parsed.success) {
        throw AppError.badRequest(
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }

      const existing = credentialRepo.findById(id);
      if (!existing || existing.userId !== authCtx.userId) {
        throw AppError.notFound("CREDENTIAL_NOT_FOUND", "Credential not found");
      }

      const key = getEncryptionKey();
      const encryptedValue = aesEncrypt(parsed.data.value, key);
      const updated = credentialRepo.update(id, encryptedValue);
      if (!updated) {
        throw AppError.notFound("CREDENTIAL_NOT_FOUND", "Credential not found");
      }

      logger.info({ userId: authCtx.userId, id }, "Credential updated");
      return c.json({ data: { success: true }, error: null });
    },
  );

  app.delete(
    "/playground/credentials/:id",
    requirePermission("ornn:playground:use"),
    async (c) => {
      const authCtx = getAuth(c);
      const id = c.req.param("id");

      const deleted = credentialRepo.delete(id, authCtx.userId);
      if (!deleted) {
        throw AppError.notFound("CREDENTIAL_NOT_FOUND", "Credential not found");
      }

      logger.info({ userId: authCtx.userId, id }, "Credential deleted");
      return c.json({ data: { success: true }, error: null });
    },
  );

  // -------------------------------------------------------------------------
  // Chat (SSE Streaming)
  // -------------------------------------------------------------------------

  app.post(
    "/playground/chat",
    requirePermission("ornn:playground:use"),
    async (c) => {
      const authCtx = getAuth(c);
      const userToken = getUserToken(c);
      const body = await c.req.json();
      const parsed = chatRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw AppError.badRequest(
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }

      logger.info({ userId: authCtx.userId, messageCount: parsed.data.messages.length }, "Chat request");

      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");
      c.header("X-Accel-Buffering", "no");

      return streamSSE(c, async (stream) => {
        const keepAlive = setInterval(() => {
          stream.writeSSE({ data: "", event: "keepalive" }).catch(() => {});
        }, keepAliveIntervalMs);

        try {
          const signal = c.req.raw.signal;
          const chatRequest: PlaygroundChatRequest = parsed.data;

          for await (const event of chatService.chat(authCtx.userId, chatRequest, userToken, signal)) {
            await stream.writeSSE({ data: JSON.stringify(event) });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Chat stream failed";
          logger.error({ userId: authCtx.userId, err: message }, "Chat stream error");
          await stream.writeSSE({
            data: JSON.stringify({ type: "error", message }),
          });
        } finally {
          clearInterval(keepAlive);
        }
      });
    },
  );

  return app;
}
