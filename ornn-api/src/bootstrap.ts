/**
 * Bootstrap for the consolidated ornn-api service.
 * Wires up all domains: skillCrud, skillSearch, skillGeneration, playground, admin, skillFormat.
 * Uses NyxID auth, chrono-storage, chrono-sandbox, Nyx Provider.
 * @module bootstrap
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import pino from "pino";
import type { SkillConfig } from "./infra/config";

const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"));


// Auth setup
import { proxyAuthSetup, nyxidOrgLookupMiddleware } from "./middleware/nyxidAuth";
import { requestIdMiddleware, getRequestId } from "./middleware/requestId";

// Infrastructure
import { connectMongo, type MongoConnection } from "./infra/db/mongodb";


// Clients
import { StorageClient } from "./clients/storageClient";
import { SandboxClient } from "./clients/sandboxClient";
import { NyxLlmClient } from "./clients/nyxLlmClient";
import { NyxidOrgsClient } from "./clients/nyxidOrgsClient";

// Domain: Skill CRUD
import { SkillRepository } from "./domains/skillCrud/repository";
import { SkillVersionRepository } from "./domains/skillCrud/skillVersionRepository";
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

// Domain: Me (caller-scoped endpoints)
import { createMeRoutes } from "./domains/me/routes";

// Domain: Users (directory lookup)
import { createUserRoutes } from "./domains/users/routes";

// OpenAPI spec
import { buildSpec } from "./openapi/specBuilder";

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
  }).child({ service: "ornn-api" });

  logger.info("Bootstrapping ornn-api service...");

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
    logger.info("Acquiring SA access token for proxy-authenticated services");
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
  const needsSandboxProxyAuth = config.sandboxServiceUrl.includes("proxy");
  const sandboxClient = new SandboxClient(
    config.sandboxServiceUrl,
    needsSandboxProxyAuth ? getSaAccessToken : undefined,
  );
  const nyxLlmClient = new NyxLlmClient({
    gatewayUrl: config.nyxLlmGatewayUrl,
    tokenUrl: config.nyxidTokenUrl,
    clientId: config.nyxidClientId,
    clientSecret: config.nyxidClientSecret,
  });

  // ---- Repositories ----
  const skillRepo = new SkillRepository(db);
  const skillVersionRepo = new SkillVersionRepository(db);
  await skillVersionRepo.ensureIndexes();
  const categoryRepo = new CategoryRepository(db);
  const tagRepo = new TagRepository(db);
  const activityRepo = new ActivityRepository(db);

  // ---- Domain: Skill CRUD ----
  const skillService = new SkillService({
    skillRepo,
    skillVersionRepo,
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
    nyxidBaseUrl: config.nyxidBaseUrl,
    skillRepo,
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
    generationService,
    nyxidTokenUrl: config.nyxidTokenUrl,
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

  // CORS — must run before auth so OPTIONS preflights are handled.
  // NOTE: origin reflection + credentials is a security gap that a follow-up
  // PR replaces with an env-driven allowlist. Deployment env changes are
  // coordinated separately; until then, the behavior below matches what
  // shipped previously.
  app.use("*", cors({
    origin: (origin) => origin,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-User-Email", "X-User-Display-Name"],
    exposeHeaders: ["Content-Length", "X-Request-ID"],
    credentials: true,
    maxAge: 86400,
  }));

  // Request-ID middleware — generate or echo X-Request-ID per request so
  // every log line and error response carries the correlation id.
  app.use("*", requestIdMiddleware());

  // Global request logging (uses requestId set by middleware above)
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    logger.info({
      requestId: getRequestId(c),
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
    const requestId = getRequestId(c);
    const appErr = err as AppError;
    if (appErr.name === "AppError" && typeof appErr.statusCode === "number" && typeof appErr.code === "string") {
      logger.warn({ requestId, code: appErr.code, status: appErr.statusCode }, appErr.message);
      return c.json({ data: null, error: { code: appErr.code, message: appErr.message } }, appErr.statusCode as any);
    }

    logger.error({ requestId, err }, "Unhandled error");
    return c.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      500,
    );
  });

  // ---- NyxID Orgs Client — used by the per-request org-membership lookup ----
  const nyxidOrgsClient = new NyxidOrgsClient(config.nyxidBaseUrl);

  // ---- API routes — all traffic via NyxID proxy, trust proxy headers ----
  const apiApp = new Hono();
  apiApp.use("*", proxyAuthSetup());
  // Lazy, per-request memoized org lookup. Mounted once here so every domain
  // route sees the same cached result — avoids re-querying NyxID within a
  // single request even when multiple routes call `readUserOrgMemberships`.
  apiApp.use("*", nyxidOrgLookupMiddleware(nyxidOrgsClient));
  apiApp.route("/", skillRoutes);
  apiApp.route("/", searchRoutes);
  apiApp.route("/", generationRoutes);
  apiApp.route("/", playgroundRoutes);
  apiApp.route("/", adminRoutes);
  apiApp.route("/", formatRoutes);
  apiApp.route("/", docsRoutes);
  apiApp.route("/", createMeRoutes({
    nyxidBaseUrl: config.nyxidBaseUrl,
    skillRepo,
    activityRepo,
  }));
  apiApp.route("/", createUserRoutes({ activityRepo }));
  app.route("/api", apiApp);

  // OpenAPI spec — auto-generated from Zod schemas
  const spec = buildSpec();
  app.get("/api/openapi.json", (c) => c.json(spec));

  // Kubernetes liveness probe — process is alive. No dependency checks.
  // `/health` kept as an alias for backward compatibility; K8s manifests
  // should migrate to `/livez`.
  const livenessHandler = (c: any) =>
    c.json({
      status: "ok",
      service: "ornn-api",
      version: pkg.version,
      timestamp: new Date().toISOString(),
    });
  app.get("/livez", livenessHandler);
  app.get("/health", livenessHandler);

  // Kubernetes readiness probe — pings Mongo with a short timeout. Returns
  // 503 when the dependency is unreachable so traffic is drained from this
  // pod until it recovers.
  app.get("/readyz", async (c) => {
    const start = Date.now();
    try {
      const pingResult = Promise.resolve(db.command({ ping: 1 }));
      await Promise.race([
        pingResult,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("mongo ping timeout")), 2000),
        ),
      ]);
      return c.json(
        {
          status: "ready",
          service: "ornn-api",
          mongoLatencyMs: Date.now() - start,
        },
        200,
      );
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "readyz: Mongo unreachable");
      return c.json(
        { status: "not_ready", reason: "mongo_unreachable" },
        503,
      );
    }
  });

  logger.info("ornn-api bootstrap complete");

  // ---- Shutdown ----
  async function shutdown(): Promise<void> {
    logger.info("Shutting down ornn-api...");
    await mongo.close();
    logger.info("ornn-api shutdown complete");
  }

  return { app, shutdown };
}
