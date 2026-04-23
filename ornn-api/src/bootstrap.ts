/**
 * Bootstrap for the consolidated ornn-api service.
 * Wires up all domains: skills (crud/search/generation/format), playground,
 * admin, me, users. Uses NyxID auth, chrono-storage, chrono-sandbox,
 * Nyx Provider.
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
import { NyxLlmClient } from "./clients/nyxid/llm";
import { NyxidOrgsClient } from "./clients/nyxid/orgs";
import { NyxidSaTokenProvider } from "./clients/nyxid/base";

// Domain: Skill CRUD
import { SkillRepository } from "./domains/skills/crud/repository";
import { SkillVersionRepository } from "./domains/skills/crud/skillVersionRepository";
import { SkillService } from "./domains/skills/crud/service";
import { createSkillRoutes } from "./domains/skills/crud/routes";

// Domain: Skill Audit
import { AuditRepository } from "./domains/skills/audit/repository";
import { AuditService } from "./domains/skills/audit/service";
import { createAuditRoutes } from "./domains/skills/audit/routes";

// Domain: Shares (audit-gated sharing)
import { ShareRepository } from "./domains/shares/repository";
import { ShareService } from "./domains/shares/service";
import { createShareRoutes } from "./domains/shares/routes";

// Domain: Notifications
import { NotificationRepository } from "./domains/notifications/repository";
import { NotificationService } from "./domains/notifications/service";
import { createNotificationRoutes } from "./domains/notifications/routes";

// Domain: Skill Search
import { SearchService } from "./domains/skills/search/service";
import { createSearchRoutes } from "./domains/skills/search/routes";

// Domain: Skill Generation
import { SkillGenerationService } from "./domains/skills/generation/service";
import { createGenerationRoutes } from "./domains/skills/generation/routes";

// Domain: Playground
import { PlaygroundChatService } from "./domains/playground/chatService";
import { createPlaygroundRoutes } from "./domains/playground/routes";

// Domain: Admin
import { CategoryRepository, TagRepository } from "./domains/admin/repository";
import { AdminService } from "./domains/admin/service";
import { ActivityRepository } from "./domains/admin/activityRepository";
import { createAdminRoutes } from "./domains/admin/routes";

// Domain: Skill Format
import { createFormatRoutes } from "./domains/skills/format/routes";

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
  const saTokenProvider = new NyxidSaTokenProvider(
    config.nyxidTokenUrl,
    config.nyxidClientId,
    config.nyxidClientSecret,
  );
  const getSaAccessToken = () => saTokenProvider.getAccessToken();

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

  // ---- Domain: Skill Audit ----
  const auditRepo = new AuditRepository(db);
  void auditRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "Audit indexes ensureIndexes failed — proceeding anyway"),
  );
  const auditService = new AuditService({
    auditRepo,
    skillService,
    storageClient,
    storageBucket: config.storageBucket,
    llmClient: nyxLlmClient,
    model: config.defaultLlmModel,
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  const auditRoutes = createAuditRoutes({ auditService, skillService });

  // ---- Domain: Shares (audit-gated sharing) ----
  // ---- Domain: Notifications ----
  const notificationRepo = new NotificationRepository(db);
  void notificationRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "notifications indexes ensureIndexes failed — proceeding anyway"),
  );
  const notificationService = new NotificationService({ notificationRepo });
  const notificationRoutes = createNotificationRoutes({ notificationService });

  const shareRepo = new ShareRepository(db);
  void shareRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "share_requests indexes ensureIndexes failed — proceeding anyway"),
  );
  const shareService = new ShareService({
    shareRepo,
    auditService,
    skillService,
    notificationService,
  });
  const shareRoutes = createShareRoutes({ shareService });

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

  // ---- Hono App ----
  const app = new Hono();

  // CORS — must run before auth so OPTIONS preflights are handled.
  // Origin allow-list is driven by the `ALLOWED_ORIGINS` env var. Empty
  // list denies all cross-origin requests (same-origin still works). The
  // previous `origin: (origin) => origin` reflection combined with
  // `credentials: true` was a CSRF-class gap.
  const allowedOrigins = new Set(config.allowedOrigins);
  app.use("*", cors({
    origin: (origin) => (origin && allowedOrigins.has(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
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

  // Global error handler — single `AppError` hierarchy across the whole
  // service, so `instanceof` is sufficient (no more duck-typing).
  app.onError((err, c) => {
    const requestId = getRequestId(c);
    if (err instanceof AppError) {
      logger.warn({ requestId, code: err.code, status: err.statusCode }, err.message);
      return c.json(
        { data: null, error: { code: err.code, message: err.message } },
        err.statusCode as any,
      );
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
  apiApp.route("/", auditRoutes);
  apiApp.route("/", shareRoutes);
  apiApp.route("/", notificationRoutes);
  apiApp.route("/", searchRoutes);
  apiApp.route("/", generationRoutes);
  apiApp.route("/", playgroundRoutes);
  apiApp.route("/", adminRoutes);
  apiApp.route("/", formatRoutes);
  apiApp.route("/", createMeRoutes({
    nyxidBaseUrl: config.nyxidBaseUrl,
    skillRepo,
    activityRepo,
  }));
  apiApp.route("/", createUserRoutes({ activityRepo }));
  app.route("/api/v1", apiApp);

  // OpenAPI spec — auto-generated from Zod schemas
  const spec = buildSpec();
  app.get("/api/v1/openapi.json", (c) => c.json(spec));

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
