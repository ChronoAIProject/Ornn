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
import { type SkillConfig, assertMirrorConfigComplete } from "./infra/config";

const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"));


// Auth setup
import { proxyAuthSetup, nyxidOrgLookupMiddleware } from "./middleware/nyxidAuth";
import { AdminUsersRepository } from "./domains/admin-users/repository";
import { requestIdMiddleware, getRequestId } from "./middleware/requestId";

// Universal API audit (issue #245)
import {
  auditMiddleware,
  ApiAuditRepository,
  AuditBodyStorage,
} from "./middleware/audit";

// Infrastructure
import { connectMongo, type MongoConnection } from "./infra/db/mongodb";
import { createAnalyticsEmitter } from "./infra/analytics";
import { AgentSealScanner } from "./infra/agentseal";


// Clients
import { StorageClient } from "./clients/storageClient";
import { SandboxClient } from "./clients/sandboxClient";
import { NyxLlmClient } from "./clients/nyxid/llm";
import { NyxidOrgsClient } from "./clients/nyxid/orgs";
import { NyxidServiceClient } from "./clients/nyxid/service";
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


// Domain: Notifications
import { NotificationRepository } from "./domains/notifications/repository";
import { NotificationService } from "./domains/notifications/service";
import { createNotificationRoutes } from "./domains/notifications/routes";

// Domain: Analytics
import { AnalyticsRepository } from "./domains/analytics/repository";
import { AnalyticsService } from "./domains/analytics/service";
import { createAnalyticsRoutes } from "./domains/analytics/routes";

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

// Domain: GitHub Mirror (public + system skill auto-mirror)
import { GitHubAppAuth } from "./domains/skills/mirror/githubAppAuth";
import { GitHubMirrorClient } from "./domains/skills/mirror/githubMirrorClient";
import { MirrorService } from "./domains/skills/mirror/mirrorService";
import { createMirrorRoutes } from "./domains/skills/mirror/routes";

// Domain: Me (caller-scoped endpoints)
import { createMeRoutes } from "./domains/me/routes";

// Domain: Users (directory lookup)
import { createUserRoutes } from "./domains/users/routes";

// Domain: Platform settings (admin-editable thresholds, etc.)
import { PlatformSettingsRepository } from "./domains/platform/repository";
import { PlatformSettingsService } from "./domains/platform/service";
import { createPlatformSettingsRoutes } from "./domains/platform/routes";

// Domain: Quota (per-user playground / skill-gen counters + admin grants)
import { QuotaRepository } from "./domains/quota/repository";
import { QuotaService } from "./domains/quota/service";
import { createQuotaRoutes } from "./domains/quota/routes";

// Domain: Models (admin-curated Chrono LLM catalog + user picker)
import { ModelsRepository } from "./domains/models/repository";
import { ModelsService } from "./domains/models/service";
import { createModelsRoutes } from "./domains/models/routes";
import { NyxLlmCatalogClient } from "./clients/nyxid/llmCatalog";

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

  // ---- PostHog product analytics (#252). Sink is Noop when no API key.
  const analyticsEmitter = createAnalyticsEmitter(
    {
      posthogApiKey: config.posthogApiKey,
      posthogHost: config.posthogHost,
      posthogProjectId: config.posthogProjectId,
      posthogErrorSampleRate: config.posthogErrorSampleRate,
    },
    logger,
  );

  // ---- AgentSeal trust scanner (#253). Subprocess wrapper —
  // `agentseal guard` doesn't accept skill packages, so we ship a small
  // Python wrapper (`/opt/agentseal/scan_skill.py`) that imports
  // `agentseal.skill_scanner.SkillScanner` directly and runs it per
  // file in the extracted ZIP.
  const agentsealScanner = new AgentSealScanner({
    python: config.agentsealPython,
    script: config.agentsealScript,
    timeoutMs: config.agentsealTimeoutMs,
    enabled: config.agentsealEnabled,
    logger,
  });

  // Validate the mirror config up front (loud) — otherwise an
  // ENABLED-but-misconfigured deployment would only fail at first
  // publish hook fire-and-forget, where the failure gets swallowed.
  assertMirrorConfigComplete(config);

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
  // The platform-settings service is wired ~80 lines below this point.
  // We can't pass a `platformSettingsService` reference here (forward
  // dependency), so we hold a mutable slot and the resolver closes over
  // it. By the time the first LLM request fires, the slot is populated.
  let llmOverrideSource: { getLlmProviderConfig: () => Promise<{ gatewayUrl: string; apiKey: string }> } | null = null;
  const nyxLlmClient = new NyxLlmClient({
    gatewayUrl: config.nyxLlmGatewayUrl,
    tokenUrl: config.nyxidTokenUrl,
    clientId: config.nyxidClientId,
    clientSecret: config.nyxidClientSecret,
    overrideResolver: async () => {
      if (!llmOverrideSource) return { gatewayUrl: "", apiKey: "" };
      return llmOverrideSource.getLlmProviderConfig();
    },
  });

  // ---- Repositories ----
  const skillRepo = new SkillRepository(db);
  const skillVersionRepo = new SkillVersionRepository(db);
  await skillVersionRepo.ensureIndexes();
  const categoryRepo = new CategoryRepository(db);
  const tagRepo = new TagRepository(db);
  const activityRepo = new ActivityRepository(db);

  // ---- Admin-users tracker ----
  // Lazy display cache: every time we see a request authenticated with
  // the admin permission, upsert the user into `admin_users`. Read by
  // `/admin/quota/users` (and any other admin list endpoint that needs
  // to mark known admins) so the UI can show "Unlimited" without
  // round-tripping NyxID per row. NyxID remains authoritative on the
  // hot path — this collection is never used for permission checks.
  const adminUsersRepo = new AdminUsersRepository(db);
  void adminUsersRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "admin_users indexes ensureIndexes failed — proceeding anyway"),
  );

  // ---- Universal API audit (issue #245) ----
  // Built early so the middleware can mount on `apiApp` below. Indexes
  // ensured fire-and-forget — a Mongo hiccup at startup must not block
  // the API from serving traffic; audit failures degrade silently.
  const apiAuditRepository = new ApiAuditRepository(db, config.auditRetentionDays);
  void apiAuditRepository.ensureIndexes().catch((err) =>
    logger.warn({ err }, "api_audit indexes ensureIndexes failed — proceeding anyway"),
  );
  const auditBodyStorage = new AuditBodyStorage(storageClient, config.auditMinioBucket);

  // ---- Domain: Skill CRUD ----
  const skillService = new SkillService({
    skillRepo,
    skillVersionRepo,
    storageClient,
    storageBucket: config.storageBucket,
    analyticsEmitter,
    agentsealScanner,
  });

  // ---- Domain: Notifications (built before AuditService so the audit
  //   pipeline can fan out completion notifications) ----
  const notificationRepo = new NotificationRepository(db);
  void notificationRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "notifications indexes ensureIndexes failed — proceeding anyway"),
  );
  const notificationService = new NotificationService({ notificationRepo });
  const notificationRoutes = createNotificationRoutes({ notificationService });

  // ---- NyxID Orgs Client — built early so the audit fan-out can expand
  //   sharedWithOrgs into member rosters when sending consumer notifications.
  const nyxidOrgsClient = new NyxidOrgsClient(config.nyxidBaseUrl, saTokenProvider);

  // ---- NyxID Service Client — used by the skill→service tie endpoint
  //   and the picker (`/me/nyxid-services`). Per-token cached.
  const nyxidServiceClient = new NyxidServiceClient(config.nyxidBaseUrl);

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
    // Audits are re-run automatically when the cached record ages past
    // this TTL, even if the skill bytes haven't changed. 30 days keeps
    // LLM spend reasonable while still catching drift in the audit
    // prompt / model over time.
    cacheTtlMs: 30 * 24 * 60 * 60 * 1000,
    notificationService,
    nyxidOrgsClient,
  });
  const auditRoutes = createAuditRoutes({ auditService, skillService });

  // ---- Domain: Analytics ----
  const analyticsRepo = new AnalyticsRepository(db);
  void analyticsRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "skill_executions indexes ensureIndexes failed — proceeding anyway"),
  );
  const analyticsService = new AnalyticsService({ analyticsRepo });
  const analyticsRoutes = createAnalyticsRoutes({ analyticsService, skillService });

  // ---- Domain: Platform settings (admin-editable thresholds + mirror coords) ----
  const platformSettingsRepo = new PlatformSettingsRepository(db);
  const platformSettingsService = new PlatformSettingsService(platformSettingsRepo, {
    githubMirror: {
      owner: config.mirror.repoOwner,
      repo: config.mirror.repoName,
      branch: config.mirror.defaultBranch,
    },
    encryptionKey: config.encryptionKey,
  });
  const platformSettingsRoutes = createPlatformSettingsRoutes({ platformSettingsService });

  // Now that platformSettingsService exists, hand it to the LLM client
  // so admin overrides take effect on the next LLM call without a
  // restart. The closure captured by `overrideResolver` above reads
  // through this slot.
  llmOverrideSource = platformSettingsService;

  // ---- Domain: Quota (per-user playground / skill-gen counters + admin grants) ----
  const quotaRepo = new QuotaRepository(db);
  void quotaRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "quota indexes ensureIndexes failed — proceeding anyway"),
  );
  const quotaService = new QuotaService({
    repo: quotaRepo,
    notificationService,
  });
  const quotaRoutes = createQuotaRoutes({
    quotaService,
    activityRepo,
    adminUsersRepo,
  });

  // ---- Domain: Models (admin-curated Chrono LLM catalog + user picker) ----
  const modelsRepo = new ModelsRepository(db);
  void modelsRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "models indexes ensureIndexes failed — proceeding anyway"),
  );
  // The catalog client speaks to NyxID's Chrono LLM proxy. Refresh
  // happens on demand from the admin UI; no scheduled cron.
  const llmCatalogClient = new NyxLlmCatalogClient({
    proxyBaseUrl: config.nyxidBaseUrl,
    saTokenProvider,
  });
  const modelsService = new ModelsService({
    repo: modelsRepo,
    catalogClient: llmCatalogClient,
  });
  const modelsRoutes = createModelsRoutes({ modelsService });

  // ---- Domain: GitHub Mirror ----
  // Built before the skill routes so we can inject it into the route
  // handlers as a fire-and-forget hook target. The MirrorService's
  // `enabled` flag short-circuits all operations when the feature is
  // off, so callers don't need to null-check.
  //
  // Repo coordinates are resolved at call time from
  // `platformSettingsService` (DB-wins-with-configmap-fallback), so an
  // admin patch via `POST /api/v1/github/repo` lands on the next sync
  // without a redeploy.
  const mirrorService = (() => {
    if (!config.mirror.enabled) {
      return new MirrorService(
        {
          // The deps are unused when disabled; pass placeholders.
          github: undefined as unknown as GitHubMirrorClient,
          skillRepo,
          skillService,
          ornnPublicOrigin: config.ornnPublicOrigin,
          platformSettingsService,
        },
        false,
      );
    }
    const auth = new GitHubAppAuth({
      appId: config.mirror.appId,
      privateKey: config.mirror.privateKey,
      installationId: config.mirror.installationId,
    });
    const github = new GitHubMirrorClient(auth, async () => {
      const cfg = await platformSettingsService.getGithubMirrorRepo();
      return { owner: cfg.owner, repo: cfg.repo, defaultBranch: cfg.branch };
    });
    return new MirrorService(
      {
        github,
        skillRepo,
        skillService,
        ornnPublicOrigin: config.ornnPublicOrigin,
        platformSettingsService,
      },
      true,
    );
  })();
  const mirrorRoutes = createMirrorRoutes({
    mirrorService: config.mirror.enabled ? mirrorService : undefined,
    platformSettingsService,
    skillRepo,
    mirrorEnabled: config.mirror.enabled,
  });

  // Skill routes — sharing is now a direct PUT /permissions write; the
  // audit signal is surfaced as a per-version label, not a gate.
  const skillRoutes = createSkillRoutes({
    skillService,
    skillRepo,
    analyticsService,
    analyticsEmitter,
    maxFileSize: config.maxPackageSizeBytes,
    activityRepo,
    nyxidServiceClient,
    extraNyxidServices: config.extraNyxidServices,
    mirrorService,
  });

  // ---- Domain: Skill Search ----
  const searchService = new SearchService({
    skillRepo,
    llmClient: nyxLlmClient,
    defaultModel: config.defaultLlmModel,
  });

  const searchRoutes = createSearchRoutes({
    searchService,
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
    quotaService,
    modelsService,
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
    analyticsService,
    skillService,
    quotaService,
    modelsService,
  });

  // ---- Domain: Admin ----
  const adminService = new AdminService(categoryRepo, tagRepo);
  const adminRoutes = createAdminRoutes({
    adminService,
    activityRepo,
    skillRepo,
    skillService,
    skillVersionRepo,
    generationService,
    nyxidTokenUrl: config.nyxidTokenUrl,
    agentsealScanner,
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
    // userId is optional on auth-context; use null distinct id when absent.
    const authCtx = (c.get as (k: string) => unknown)("auth") as
      | { userId?: string }
      | undefined;
    const userId = authCtx?.userId ?? null;

    if (err instanceof AppError) {
      logger.warn({ requestId, code: err.code, status: err.statusCode }, err.message);
      // 5xx AppErrors are still real server failures — emit api.error
      // (sampled) so PostHog has the same fidelity as runtime crashes.
      if (err.statusCode >= 500) {
        analyticsEmitter.trackApiError({
          userId,
          statusCode: err.statusCode,
          errorCode: err.code,
          method: c.req.method,
          path: c.req.path,
          requestId,
        });
      }
      return c.json(
        { data: null, error: { code: err.code, message: err.message } },
        err.statusCode as any,
      );
    }

    logger.error({ requestId, err }, "Unhandled error");
    analyticsEmitter.trackApiError({
      userId,
      statusCode: 500,
      errorCode: "INTERNAL_ERROR",
      method: c.req.method,
      path: c.req.path,
      requestId,
    });
    return c.json(
      { data: null, error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      500,
    );
  });

  // ---- API routes — all traffic via NyxID proxy, trust proxy headers ----
  const apiApp = new Hono();
  apiApp.use(
    "*",
    proxyAuthSetup({
      // Lazy admin-user tracking: whenever we see a request authenticated
      // with the admin permission, upsert the user. Fire-and-forget;
      // failure is logged inside the repo and never bubbles up.
      onAuthSeen: (auth) => {
        if (auth.permissions.includes("ornn:admin:skill")) {
          void adminUsersRepo.upsert({
            userId: auth.userId,
            email: auth.email,
            displayName: auth.displayName,
          });
        }
      },
    }),
  );
  // Universal API audit — runs after `proxyAuthSetup` so the
  // caller-type resolver can read `c.var.auth`. Fail-isolated: errors
  // inside the audit pipeline never propagate to the business response.
  apiApp.use(
    "*",
    auditMiddleware({
      repository: apiAuditRepository,
      bodyStorage: auditBodyStorage,
      bodyInlineMaxBytes: config.auditBodyInlineMaxBytes,
      extraBlacklistPatterns: config.auditGlobalRedactPatterns,
      logger,
      // Resolve auth shape from the Hono context. Auth-setup middleware
      // populates `auth` with `userAccessToken` only when the NyxID
      // proxy forwarded a user Bearer alongside the identity token —
      // i.e. agent flows; browser cookie sessions leave it undefined.
      resolveAuthHint: (c) => {
        const auth = c.get("auth") as
          | { userId?: string; userAccessToken?: string }
          | undefined;
        if (!auth?.userId) {
          return {
            hasAuth: false,
            hasForwardedUserToken: false,
            callerIdentity: null,
          };
        }
        return {
          hasAuth: true,
          hasForwardedUserToken: Boolean(auth.userAccessToken),
          callerIdentity: auth.userId,
        };
      },
    }),
  );
  // Lazy, per-request memoized org lookup. Mounted once here so every domain
  // route sees the same cached result — avoids re-querying NyxID within a
  // single request even when multiple routes call `readUserOrgMemberships`.
  apiApp.use("*", nyxidOrgLookupMiddleware(nyxidOrgsClient));
  apiApp.route("/", skillRoutes);
  apiApp.route("/", mirrorRoutes);
  apiApp.route("/", auditRoutes);
  apiApp.route("/", notificationRoutes);
  apiApp.route("/", analyticsRoutes);
  apiApp.route("/", searchRoutes);
  apiApp.route("/", generationRoutes);
  apiApp.route("/", playgroundRoutes);
  apiApp.route("/", adminRoutes);
  apiApp.route("/", platformSettingsRoutes);
  apiApp.route("/", quotaRoutes);
  apiApp.route("/", modelsRoutes);
  apiApp.route("/", formatRoutes);
  apiApp.route("/", createMeRoutes({
    nyxidBaseUrl: config.nyxidBaseUrl,
    skillRepo,
    activityRepo,
    nyxidServiceClient,
    extraNyxidServices: config.extraNyxidServices,
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
    // Drain PostHog buffer before closing Mongo — losing buffered events
    // is the most common cause of "missing api.error" complaints.
    try {
      await analyticsEmitter.shutdown();
    } catch (err) {
      logger.warn({ err }, "Analytics shutdown failed — continuing");
    }
    await mongo.close();
    logger.info("ornn-api shutdown complete");
  }

  return { app, shutdown };
}
