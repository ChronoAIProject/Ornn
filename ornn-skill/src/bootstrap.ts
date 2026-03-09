/**
 * Bootstrap for the consolidated ornn-skill service.
 * Wires up all domains: skillCrud, skillSearch, skillGeneration, playground, admin, skillFormat.
 * Uses NyxID auth, chrono-storage, chrono-sandbox, Nyx Provider.
 * @module bootstrap
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import pino from "pino";
import type { SkillConfig } from "./infra/config";
import type { NyxIDAuthConfig } from "./middleware/nyxidAuth";

// Infrastructure
import { connectMongo, type MongoConnection } from "./infra/db/mongodb";
import { initSqlite, closeSqlite } from "./infra/db/sqlite";

// Clients
import { StorageClient } from "./clients/storageClient";
import { SandboxClient } from "./clients/sandboxClient";
import { NyxLlmClient } from "./clients/nyxLlmClient";

// Domain: Skill CRUD
import { SkillRepository } from "./domains/skillCrud/repository";
import { SkillService } from "./domains/skillCrud/service";
import { createSkillRoutes } from "./domains/skillCrud/routes";

// Domain: Skill Search
import { SearchService } from "./domains/skillSearch/service";
import { createSearchRoutes } from "./domains/skillSearch/routes";

// Domain: Skill Generation
import { SkillGenerationService } from "./domains/skillGeneration/service";
import { createGenerationRoutes } from "./domains/skillGeneration/routes";

// Domain: Playground
import { CredentialRepository } from "./domains/playground/credentialRepository";
import { PlaygroundChatService } from "./domains/playground/chatService";
import { createPlaygroundRoutes } from "./domains/playground/routes";

// Domain: Admin
import { CategoryRepository, TagRepository } from "./domains/admin/repository";
import { AdminService } from "./domains/admin/service";
import { createAdminRoutes } from "./domains/admin/routes";

// Domain: Skill Format
import { createFormatRoutes } from "./domains/skillFormat/routes";

// Error handler
import { AppError } from "./shared/types/index";

export interface BootstrapResult {
  app: Hono;
  shutdown: () => Promise<void>;
}

export async function bootstrap(config: SkillConfig): Promise<BootstrapResult> {
  const logger = pino({
    level: config.logLevel,
    ...(config.logPretty ? { transport: { target: "pino-pretty" } } : {}),
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers[\"x-api-key\"]",
        "*.password",
        "*.secret",
        "*.apiKey",
        "*.encryptedValue",
      ],
    },
  }).child({ service: "ornn-skill" });

  logger.info("Bootstrapping ornn-skill service...");

  // ---- NyxID Auth Config ----
  const authConfig: NyxIDAuthConfig = {
    jwksUrl: config.nyxidJwksUrl,
    issuer: config.nyxidIssuer,
    audience: config.nyxidAudience,
    introspectionUrl: config.nyxidIntrospectionUrl,
    clientId: config.nyxidClientId,
    clientSecret: config.nyxidClientSecret,
  };

  // ---- Database Connections ----
  const mongo: MongoConnection = await connectMongo(config.mongodbUri, config.mongodbDb);
  const db = mongo.db;
  logger.info("MongoDB connected");

  const sqliteDb = await initSqlite(config.dataDir);
  logger.info("SQLite initialized");

  // ---- External Clients ----
  const storageClient = new StorageClient(config.storageServiceUrl);
  const sandboxClient = new SandboxClient(config.sandboxServiceUrl);
  const nyxLlmClient = new NyxLlmClient(config.nyxLlmGatewayUrl);

  // ---- Repositories ----
  const skillRepo = new SkillRepository(db);
  const credentialRepo = new CredentialRepository(sqliteDb);
  const categoryRepo = new CategoryRepository(db);
  const tagRepo = new TagRepository(db);

  // ---- Domain: Skill CRUD ----
  const skillService = new SkillService({
    skillRepo,
    storageClient,
    storageBucket: config.storageBucket,
  });

  const skillRoutes = createSkillRoutes({
    skillService,
    skillRepo,
    authConfig,
    maxFileSize: config.maxPackageSizeBytes,
  });

  // ---- Domain: Skill Search ----
  const searchService = new SearchService({
    skillRepo,
    llmClient: nyxLlmClient,
    defaultModel: config.defaultLlmModel,
  });

  const searchRoutes = createSearchRoutes({
    searchService,
    authConfig,
  });

  // ---- Domain: Skill Generation ----
  const generationService = new SkillGenerationService({
    llmClient: nyxLlmClient,
    defaultModel: config.defaultLlmModel,
    maxOutputTokens: config.llmMaxOutputTokens,
    temperature: config.llmTemperature,
  });

  const generationRoutes = createGenerationRoutes({
    generationService,
    authConfig,
    keepAliveIntervalMs: config.sseKeepAliveIntervalMs,
  });

  // ---- Domain: Playground ----
  const chatService = new PlaygroundChatService({
    llmClient: nyxLlmClient,
    sandboxClient,
    skillService,
    defaultModel: config.defaultLlmModel,
    maxOutputTokens: config.llmMaxOutputTokens,
    temperature: config.llmTemperature,
  });

  const playgroundRoutes = createPlaygroundRoutes({
    credentialRepo,
    chatService,
    authConfig,
    platformMasterKey: config.platformMasterKey,
    keepAliveIntervalMs: config.sseKeepAliveIntervalMs,
  });

  // ---- Domain: Admin ----
  const adminService = new AdminService(categoryRepo, tagRepo);
  const adminRoutes = createAdminRoutes({
    adminService,
    authConfig,
  });

  // ---- Domain: Skill Format ----
  const formatRoutes = createFormatRoutes({
    skillService,
    authConfig,
  });

  // ---- Hono App ----
  const app = new Hono();

  // CORS — must run before auth so OPTIONS preflights are handled
  app.use("*", cors({
    origin: (origin) => origin,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    exposeHeaders: ["Content-Length"],
    credentials: true,
    maxAge: 86400,
  }));

  // Global request logging
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    logger.info({
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration: ms,
    }, "Request completed");
  });

  // Global error handler
  // Use duck-typing: nyxidAuth inlines its own AppError class, so instanceof
  // against the shared AppError fails across module boundaries.
  app.onError((err, c) => {
    const appErr = err as AppError;
    if (appErr.name === "AppError" && typeof appErr.statusCode === "number" && typeof appErr.code === "string") {
      logger.warn({ code: appErr.code, status: appErr.statusCode }, appErr.message);
      return c.json({ data: null, error: { code: appErr.code, message: appErr.message } }, appErr.statusCode as any);
    }

    logger.error({ err }, "Unhandled error");
    return c.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      500,
    );
  });

  // Mount domain routes under /api
  app.route("/api", skillRoutes);
  app.route("/api", searchRoutes);
  app.route("/api", generationRoutes);
  app.route("/api", playgroundRoutes);
  app.route("/api", adminRoutes);
  app.route("/api", formatRoutes);

  // Health endpoint
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "ornn-skill",
      timestamp: new Date().toISOString(),
    }),
  );

  logger.info("ornn-skill bootstrap complete");

  // ---- Shutdown ----
  async function shutdown(): Promise<void> {
    logger.info("Shutting down ornn-skill...");
    closeSqlite();
    await mongo.close();
    logger.info("ornn-skill shutdown complete");
  }

  return { app, shutdown };
}
