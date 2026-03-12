/**
 * Bootstrap for the consolidated ornn-skill service.
 * Wires up all domains: skillCrud, skillSearch, skillGeneration, playground, admin, skillFormat.
 * Uses NyxID auth, chrono-storage, chrono-sandbox, Nyx Provider.
 * @module bootstrap
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "node:path";
import pino from "pino";
import type { SkillConfig } from "./infra/config";

// Auth setup
import { jwtAuthSetup, proxyAuthSetup } from "./middleware/nyxidAuth";

// Infrastructure
import { connectMongo, type MongoConnection } from "./infra/db/mongodb";


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
import { PlaygroundChatService } from "./domains/playground/chatService";
import { createPlaygroundRoutes } from "./domains/playground/routes";

// Domain: Admin
import { CategoryRepository, TagRepository } from "./domains/admin/repository";
import { AdminService } from "./domains/admin/service";
import { ActivityRepository } from "./domains/admin/activityRepository";
import { createAdminRoutes } from "./domains/admin/routes";

// Domain: Skill Format
import { createFormatRoutes } from "./domains/skillFormat/routes";

// Domain: Docs
import { createDocsRoutes } from "./domains/docs/routes";

// OpenAPI spec
import { buildWebSpec, buildAgentSpec } from "./openapi/specBuilder";

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
      ],
    },
  }).child({ service: "ornn-skill" });

  logger.info("Bootstrapping ornn-skill service...");

  // ---- Database Connections ----
  const mongo: MongoConnection = await connectMongo(config.mongodbUri, config.mongodbDb);
  const db = mongo.db;
  logger.info("MongoDB connected");

  // ---- SA Token Provider (shared by proxy-authenticated clients) ----
  let saTokenCache: { accessToken: string; expiresAt: number } | null = null;
  const getSaAccessToken = async (): Promise<string> => {
    const now = Date.now();
    if (saTokenCache && saTokenCache.expiresAt > now + 60_000) {
      return saTokenCache.accessToken;
    }
    logger.info("Acquiring SA access token for storage proxy");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.nyxidClientId,
      client_secret: config.nyxidClientSecret,
    });
    const resp = await fetch(config.nyxidTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`SA token acquisition failed (${resp.status}): ${errText.slice(0, 200)}`);
    }
    const result = (await resp.json()) as { access_token: string; expires_in?: number };
    if (!result.access_token) throw new Error("SA token response missing access_token");
    saTokenCache = {
      accessToken: result.access_token,
      expiresAt: now + (result.expires_in ?? 900) * 1000,
    };
    return saTokenCache.accessToken;
  };

  // ---- External Clients ----
  const needsProxyAuth = config.storageServiceUrl.includes("proxy");
  const storageClient = new StorageClient(
    config.storageServiceUrl,
    needsProxyAuth ? getSaAccessToken : undefined,
  );
  const sandboxClient = new SandboxClient(config.sandboxServiceUrl);
  const nyxLlmClient = new NyxLlmClient({
    gatewayUrl: config.nyxLlmGatewayUrl,
    tokenUrl: config.nyxidTokenUrl,
    clientId: config.nyxidClientId,
    clientSecret: config.nyxidClientSecret,
  });

  // ---- Repositories ----
  const skillRepo = new SkillRepository(db);
  const categoryRepo = new CategoryRepository(db);
  const tagRepo = new TagRepository(db);
  const activityRepo = new ActivityRepository(db);

  // ---- Domain: Skill CRUD ----
  const skillService = new SkillService({
    skillRepo,
    storageClient,
    storageBucket: config.storageBucket,
  });

  const skillRoutes = createSkillRoutes({
    skillService,
    skillRepo,
    maxFileSize: config.maxPackageSizeBytes,
    activityRepo,
  });

  // ---- Domain: Skill Search ----
  const searchService = new SearchService({
    skillRepo,
    llmClient: nyxLlmClient,
    defaultModel: config.defaultLlmModel,
  });

  const searchRoutes = createSearchRoutes({
    searchService,
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
    chatService,
    keepAliveIntervalMs: config.sseKeepAliveIntervalMs,
  });

  // ---- Domain: Admin ----
  const adminService = new AdminService(categoryRepo, tagRepo);
  const adminRoutes = createAdminRoutes({
    adminService,
    activityRepo,
    skillRepo,
    skillService,
  });

  // ---- Domain: Skill Format ----
  const formatRoutes = createFormatRoutes({
    skillService,
  });

  // ---- Domain: Docs ----
  const docsRoutes = createDocsRoutes({
    docsBasePath: join(import.meta.dir, "..", "docs", "site"),
  });

  // ---- Hono App ----
  const app = new Hono();

  // CORS — must run before auth so OPTIONS preflights are handled
  app.use("*", cors({
    origin: (origin) => origin,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-User-Email", "X-User-Display-Name"],
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

  // ---- Web routes — frontend accesses ornn directly, JWT verified here ----
  const webApp = new Hono();
  webApp.use("*", jwtAuthSetup({
    jwksUrl: config.nyxidJwksUrl,
    issuer: config.nyxidIssuer,
    audience: config.nyxidAudience,
  }));
  webApp.route("/", skillRoutes);
  webApp.route("/", searchRoutes);
  webApp.route("/", generationRoutes);
  webApp.route("/", playgroundRoutes);
  webApp.route("/", adminRoutes);
  webApp.route("/", formatRoutes);
  webApp.route("/", docsRoutes);
  app.route("/api/web", webApp);

  // ---- Agent routes — accessed via NyxID proxy, trust proxy headers ----
  const agentApp = new Hono();
  agentApp.use("*", proxyAuthSetup());
  agentApp.route("/", skillRoutes);
  agentApp.route("/", searchRoutes);
  agentApp.route("/", generationRoutes);
  app.route("/api/agent", agentApp);

  // OpenAPI specs — auto-generated from Zod schemas
  const webSpec = buildWebSpec();
  const agentSpec = buildAgentSpec();
  app.get("/api/web/openapi.json", (c) => c.json(webSpec));
  app.get("/api/agent/openapi.json", (c) => c.json(agentSpec));

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
    await mongo.close();
    logger.info("ornn-skill shutdown complete");
  }

  return { app, shutdown };
}
