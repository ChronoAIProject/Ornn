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
import { type SkillConfig } from "./infra/config";

const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"));


// Auth setup
import { proxyAuthSetup, nyxidOrgLookupMiddleware } from "./middleware/nyxidAuth";
import { requestIdMiddleware, getRequestId } from "./middleware/requestId";

// Per-request analytics middleware (issue #271). Replaces the universal
// API audit middleware (#245) — every authenticated /api/v1/* request
// emits an `api.request` PostHog event with caller, method, path,
// status, durationMs, sourceIp, requestId.
import { apiRequestTrackingMiddleware } from "./middleware/apiRequestTracking";

// Infrastructure
import { connectMongo, type MongoConnection } from "./infra/db/mongodb";
import { createAnalyticsEmitter } from "./infra/analytics";
import { AgentSealScanner } from "./infra/agentseal";

// User directory — single identity cache. Replaces the activity-derived
// directory in the old `activities` collection plus the `admin_users` /
// `users_meta` cache collections (issue #271).
import { UserDirectoryRepository } from "./domains/users/repository";


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
import { dropLegacyNotificationCategories } from "./domains/notifications/migration";

// Domain: Announcements (landing-page popup)
import { AnnouncementRepository } from "./domains/announcements/repository";
import { AnnouncementService } from "./domains/announcements/service";
import { createAnnouncementRoutes } from "./domains/announcements/routes";

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
import { createAdminRoutes } from "./domains/admin/routes";

// Domain: Skill Format
import { createFormatRoutes } from "./domains/skills/format/routes";

// Domain: GitHub Mirror (public + system skill auto-mirror)
import { MirrorService } from "./domains/skills/mirror/mirrorService";
import { createMirrorRoutes } from "./domains/skills/mirror/routes";

// Domain: Me (caller-scoped endpoints)
import { createMeRoutes } from "./domains/me/routes";

// Domain: Users (directory lookup)
import { createUserRoutes } from "./domains/users/routes";

// Domain: Platform settings (legacy single-doc — still used by mirror, audit-waiver) ----
import { PlatformSettingsRepository } from "./domains/platform/repository";
import { PlatformSettingsService } from "./domains/platform/service";
import { createPlatformSettingsRoutes } from "./domains/platform/routes";

// Domain: Settings (multi-section + LLM providers + export/import) — backend-engineer-2.
import { SettingsRepository } from "./domains/settings/repository";
import { SettingsServiceImpl } from "./domains/settings/service";
import { createSettingsRoutes } from "./domains/settings/routes";
import { LlmProvidersRepository } from "./domains/settings/llmProviders/repository";
import { LlmProvidersService } from "./domains/settings/llmProviders/service";
import { createLlmProvidersRoutes } from "./domains/settings/llmProviders/routes";
import { SettingsExporter } from "./domains/settings/exportImport/exporter";
import { SettingsImporter } from "./domains/settings/exportImport/importer";
import { createSettingsExportImportRoutes } from "./domains/settings/exportImport/routes";
import { LlmModelListClient } from "./clients/llmModelListClient";

// Domain: Quota (per-user playground / skill-gen counters + admin grants)
import { QuotaRepository } from "./domains/quota/repository";
import { QuotaService } from "./domains/quota/service";
import { createQuotaRoutes } from "./domains/quota/routes";

// Domain: Redemption codes (admin-issued single-use quota grants)
import { RedemptionCodeRepository } from "./domains/redemption-codes/repository";
import { RedemptionCodeService } from "./domains/redemption-codes/service";
import { createAdminRedemptionCodesRoutes } from "./domains/admin/redemption-codes/routes";
import { createMeRedemptionCodesRoutes } from "./domains/redemption-codes/me-routes";

// Domain: Admin (engineer-1): dashboard, users, quota admin.
import { AdminDashboardService } from "./domains/admin/dashboard/service";
import { createAdminDashboardRoutes } from "./domains/admin/dashboard/routes";
import { createAdminQuotaRoutes } from "./domains/admin/quota/routes";
import { AdminUsersService } from "./domains/admin-users/service";
import { createAdminUsersRoutes } from "./domains/admin-users/routes";

// LLM provider migration (#270 — fold legacy global model catalog into
// per-provider arrays). One-time, idempotent, runs before any
// LlmProvidersService consumer reads from disk.
import { migrateModelCatalogIntoProviders } from "./domains/settings/llmProviders/migration";
import { createLlmPickerRoutes } from "./domains/settings/llmProviders/routes";

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

  // PostHog analytics emitter is constructed AFTER `settingsService` is
  // wired below — the `telemetry` section in DB is the canonical source
  // for PostHog config; env vars only kick in when DB is empty (issue
  // #271). See the construction site further down.

  // ---- AgentSeal trust scanner (#253). Subprocess wrapper —
  // `agentseal guard` doesn't accept skill packages, so we ship a small
  // Python wrapper (`/opt/agentseal/scan_skill.py`) that imports
  // `agentseal.skill_scanner.SkillScanner` directly and runs it per
  // file in the extracted ZIP.
  //
  // Per Architecture §7.2 the enabled flag and timeout move to the
  // `skillAudit` settings section. We pre-instantiate the scanner with
  // safe defaults; runtime knobs are read from settings on each scan.
  // (Wiring of the resolver into AgentSealScanner is deferred to
  // backend-engineer-2's settings section landing.)
  const agentsealScanner = new AgentSealScanner({
    python: config.agentsealPython,
    script: config.agentsealScript,
    timeoutMs: 60_000,
    enabled: true,
    logger,
  });

  // ---- Database Connections ----
  const mongo: MongoConnection = await connectMongo(config.mongodbUri, config.mongodbDb);
  const db = mongo.db;
  logger.info("MongoDB connected");

  // ---- SettingsService (multi-section + LLM providers) ----
  // Built early so every downstream client/route can take a resolver
  // closure over it. The provider-list service is wired POST-construction
  // via `setLlmProvidersAccessor` to break the circular dep
  // (LlmProvidersService -> SettingsService for the encryption key on
  // create() validation; SettingsService -> LlmProvidersService for
  // listLlmProviders/getLlmProvider on the export/admin paths).
  const settingsRepo = new SettingsRepository(db);
  const settingsService = new SettingsServiceImpl({
    repo: settingsRepo,
    encryptionKey: config.encryptionKey,
  });

  // ---- SA Token Provider (shared by proxy-authenticated clients) ----
  // Credentials live in admin Settings → Integrations → NyxID and are
  // resolved lazily on every refresh; an empty section throws a clear
  // configuration error rather than booting silently broken.
  const saTokenProvider = new NyxidSaTokenProvider(async () => {
    const s = await settingsService.getNyxid();
    return {
      tokenUrl: s.tokenUrl,
      clientId: s.clientId,
      clientSecret: s.clientSecret,
    };
  });
  const getSaAccessToken = () => saTokenProvider.getAccessToken();
  const llmProvidersRepo = new LlmProvidersRepository(db);
  void llmProvidersRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "llm_providers indexes ensureIndexes failed — proceeding anyway"),
  );
  const modelListFetcher = new LlmModelListClient();
  const llmProvidersService = new LlmProvidersService({
    repo: llmProvidersRepo,
    encryptionKey: config.encryptionKey,
    modelListFetcher,
  });
  // Late-bind: the settings service exposes provider listings to the
  // export/admin paths.
  settingsService.setLlmProvidersAccessor({
    list: () => llmProvidersService.list(),
    get: (id) => llmProvidersService.get(id),
  });

  // ---- PostHog product analytics (issue #271). DB-driven via the
  // `telemetry` settings section; env values are bootstrap fallback
  // for the very first boot when admin hasn't saved yet.
  //
  // Resolution rule: if the DB section has a non-empty `postHogApiKey`,
  // the entire DB record is authoritative. Otherwise the whole config
  // falls back to env. Avoids the half-merged "DB host with env key"
  // foot-gun that comes with per-field merging.
  const telemetrySection = await settingsService.getTelemetry();
  const dbHasPosthogConfig = !!telemetrySection.postHogApiKey;
  const analyticsEmitter = createAnalyticsEmitter(
    dbHasPosthogConfig
      ? {
          posthogEnabled: telemetrySection.postHogEnabled,
          posthogApiKey: telemetrySection.postHogApiKey,
          posthogHost: telemetrySection.postHogHost || config.posthogHost,
          posthogProjectId: telemetrySection.postHogProjectId || null,
          posthogErrorSampleRate: telemetrySection.postHogErrorSampleRate,
        }
      : {
          posthogEnabled: config.posthogEnabled,
          posthogApiKey: config.posthogApiKey,
          posthogHost: config.posthogHost,
          posthogProjectId: config.posthogProjectId,
          posthogErrorSampleRate: config.posthogErrorSampleRate,
        },
    logger,
  );
  logger.info(
    {
      source: dbHasPosthogConfig ? "telemetry-section" : "env-fallback",
      enabled: dbHasPosthogConfig
        ? telemetrySection.postHogEnabled
        : config.posthogEnabled,
    },
    "PostHog config resolved",
  );

  // ---- User directory (issue #271). Single identity cache, lazily
  // populated on every authenticated request. Replaces the old activity-
  // derived directory + `admin_users` + `users_meta` cache collections.
  const userDirectoryRepo = new UserDirectoryRepository(db);
  void userDirectoryRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "users indexes ensureIndexes failed — proceeding anyway"),
  );

  // Convenience: resolve the LLM provider for a given surface in a
  // single Promise, projecting whichever auth shape the provider uses
  // into the simpler `{ gatewayUrl, apiKey }` contract `NyxLlmClient`
  // speaks. `apiKey` empty means "use SA token-exchange flow".
  const resolveLlmProviderForSurface = async (
    surface: "playground" | "skillGen",
  ): Promise<{ gatewayUrl: string; apiKey: string }> => {
    const sec =
      surface === "playground"
        ? await settingsService.getPlayground()
        : await settingsService.getSkillGen();
    if (!sec.defaultProviderId) return { gatewayUrl: "", apiKey: "" };
    const provider = await llmProvidersService.get(sec.defaultProviderId);
    if (!provider) return { gatewayUrl: "", apiKey: "" };
    const apiKey = provider.auth.kind === "apiKey" ? provider.auth.apiKey : "";
    return { gatewayUrl: provider.gatewayUrl, apiKey };
  };

  // Same pattern, returning the per-surface model + token cap +
  // temperature snapshot the playground/skill-gen services need on
  // every request.
  //
  // After #270, the surface default lives on per-model `defaultForX`
  // flags rather than `provider.defaultModelId` — `resolveModel(...)`
  // picks the right row (surface default → first enabled → no-op),
  // and we still honour the section-level explicit `defaultModelId`
  // override for callers that want to pin a specific model regardless
  // of the cross-provider default.
  const resolveSurfaceDefaults = async (
    surface: "playground" | "skillGen",
  ): Promise<{ model: string; maxOutputTokens: number; temperature: number }> => {
    const sec =
      surface === "playground"
        ? await settingsService.getPlayground()
        : await settingsService.getSkillGen();
    let model = sec.defaultModelId ?? "";
    if (!model) {
      const resolution = await llmProvidersService.resolveModel({ surface });
      if (resolution.kind === "ok") model = resolution.modelId;
    }
    let maxOutputTokens = 8192;
    let temperature = 0.7;
    if (sec.defaultProviderId) {
      const provider = await llmProvidersService.get(sec.defaultProviderId);
      if (provider) {
        maxOutputTokens = provider.maxOutputTokens;
        temperature = provider.defaultTemperature;
      }
    }
    return { model, maxOutputTokens, temperature };
  };

  // The audit pipeline reads its own per-section knobs (LLM toggle +
  // model + AgentSeal toggle/timeout + risk threshold).
  const resolveAuditDefaults = async (): Promise<{
    model: string;
    llmEnabled: boolean;
    agentSealEnabled: boolean;
    agentSealTimeoutMs: number;
    riskThreshold: number;
  }> => {
    const sec = await settingsService.getSkillAudit();
    // Audit shares the skillGen surface for default-model resolution —
    // there's no separate "audit" surface today. After #270, the
    // section-level `llmAuditDefaultModelId` wins; otherwise fall
    // back to the cross-provider skillGen default.
    let model = sec.llmAuditDefaultModelId ?? "";
    if (!model) {
      const resolution = await llmProvidersService.resolveModel({ surface: "skillGen" });
      if (resolution.kind === "ok") model = resolution.modelId;
    }
    return {
      model,
      llmEnabled: sec.llmAuditEnabled,
      agentSealEnabled: sec.agentSealEnabled,
      agentSealTimeoutMs: sec.agentSealTimeoutMs,
      riskThreshold: sec.riskThreshold,
    };
  };

  // Synthetic NyxID services list — extras section drives this.
  const resolveExtraNyxidServiceNames = async (): Promise<readonly string[]> => {
    const sec = await settingsService.getExtras();
    return sec.extraNyxidServices.map((s) => s.name);
  };

  // ---- External Clients ----
  // Storage URL/bucket and Sandbox URL come from the NyxID integration
  // settings section (folded in from the old standalone `services`
  // section in #302). The "needs proxy auth" flag is a behavior of the
  // URL itself ("proxy" in the host); we resolve once per call so a
  // switch between direct and proxied endpoints works without a redeploy.
  const storageClient = new StorageClient({
    resolver: async () => {
      const s = await settingsService.getNyxid();
      return { baseUrl: s.chronoStorageUrl, bucket: s.chronoStorageBucket };
    },
    // Conservative: always attach SA token when present. The chrono-storage
    // proxy ignores it for direct URLs; for proxy URLs it's required.
    getAccessToken: getSaAccessToken,
  });
  const sandboxClient = new SandboxClient({
    resolver: async () => {
      const s = await settingsService.getNyxid();
      return { baseUrl: s.chronoSandboxUrl };
    },
    getAccessToken: getSaAccessToken,
  });

  // The NyxLlmClient resolver picks the playground provider as default
  // — most call sites are playground-flavoured. Skill-gen routes pass
  // a model id explicitly through the params, but the gateway/apiKey
  // selection still resolves through this single client. Backend-eng-2
  // will swap this for a per-surface provider lookup once the
  // `llm_providers` collection ships.
  const nyxLlmClient = new NyxLlmClient({
    resolver: async () => resolveLlmProviderForSurface("playground"),
    saTokenProvider,
  });

  // ---- Repositories ----
  const skillRepo = new SkillRepository(db);
  const skillVersionRepo = new SkillVersionRepository(db);
  await skillVersionRepo.ensureIndexes();

  // ---- Domain: Skill CRUD ----
  const skillService = new SkillService({
    skillRepo,
    skillVersionRepo,
    storageClient,
    storageBucketResolver: async () =>
      (await settingsService.getNyxid()).chronoStorageBucket,
    analyticsEmitter,
    agentsealScanner,
  });

  // ---- Domain: Notifications (built before AuditService so the audit
  //   pipeline can fan out completion notifications) ----
  const notificationRepo = new NotificationRepository(db);
  void notificationRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "notifications indexes ensureIndexes failed — proceeding anyway"),
  );
  // One-time boot migration (#218) — drop legacy `share.*` rows left over
  // from the pre-#198 share/audit-gate workflow. Idempotent; no-op after
  // first run. Failure is non-fatal — old rows surface as ugly UI but
  // never block the boot.
  await dropLegacyNotificationCategories(db).catch((err) =>
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "dropLegacyNotificationCategories failed — legacy notification rows may still surface in /notifications until the next deploy",
    ),
  );
  const notificationService = new NotificationService({ notificationRepo });
  const notificationRoutes = createNotificationRoutes({ notificationService });

  // ---- Domain: Announcements (landing-page popup, issue #307) ----
  const announcementRepo = new AnnouncementRepository(db);
  void announcementRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "announcements indexes ensureIndexes failed — proceeding anyway"),
  );
  const announcementService = new AnnouncementService({ repo: announcementRepo });
  const announcementRoutes = createAnnouncementRoutes({ announcementService });

  // ---- NyxID Orgs Client — built early so the audit fan-out can expand
  //   sharedWithOrgs into member rosters when sending consumer notifications.
  // Base URL is resolved from settings (`nyxid` section) on every call.
  const nyxidConfigResolver = async () => ({
    baseApiUrl: (await settingsService.getNyxid()).baseApiUrl,
  });
  const nyxidOrgsClient = new NyxidOrgsClient({
    resolver: nyxidConfigResolver,
    saTokenProvider,
  });

  // ---- NyxID Service Client — used by the skill→service tie endpoint
  //   and the picker (`/me/nyxid-services`). Per-token cached.
  const nyxidServiceClient = new NyxidServiceClient({
    resolver: nyxidConfigResolver,
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
    storageBucketResolver: async () =>
      (await settingsService.getNyxid()).chronoStorageBucket,
    llmClient: nyxLlmClient,
    defaultsResolver: async () => resolveAuditDefaults(),
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

  // ---- Domain: Platform settings (admin-editable: audit threshold, mirror config, LLM override) ----
  // Backend-engineer-2 is replacing this with a multi-section
  // `SettingsService` (one doc per section in `platform_settings`,
  // separate `llm_providers` collection). Until that lands, we adapt
  // the existing single-doc `PlatformSettings` shape into the bridge
  // contract — every field a client/route asks for is satisfied here
  // (with sensible fallbacks for sections that don't exist yet).
  const platformSettingsRepo = new PlatformSettingsRepository(db);
  const platformSettingsService = new PlatformSettingsService(platformSettingsRepo, {
    encryptionKey: config.encryptionKey,
  });
  const platformSettingsRoutes = createPlatformSettingsRoutes({ platformSettingsService });

  // ---- Settings routes (engineer-2): per-section CRUD, LLM providers,
  //   export/import.
  const settingsRoutes = createSettingsRoutes({ settingsService });
  const llmProvidersRoutes = createLlmProvidersRoutes({ llmProvidersService });
  const settingsExporter = new SettingsExporter({
    settingsService,
    ornnVersion: pkg.version,
  });
  const settingsImporter = new SettingsImporter({ settingsService });
  const settingsExportImportRoutes = createSettingsExportImportRoutes({
    exporter: settingsExporter,
    importer: settingsImporter,
    auditLogger: {
      // Fire-and-forget activity emit via PostHog. Both branches
      // swallow errors so a tracker hiccup never breaks the response —
      // `recordExport` / `recordImport` MUST NOT throw per the
      // SettingsAuditLogger contract (`exportImport/routes.ts`
      // interface comment).
      recordExport: async ({ actor, schemaVersion }) => {
        try {
          analyticsEmitter.trackPlatformActivity({
            userId: actor.userId,
            userEmail: actor.email,
            userDisplayName: actor.displayName ?? "",
            action: "settings.exported",
            properties: { schemaVersion },
          });
        } catch (err) {
          logger.warn(
            { err: (err as Error).message, actor: actor.userId },
            "settings.exported activity emit failed (swallowed)",
          );
        }
      },
      recordImport: async ({ actor, schemaVersion, aggregateStatus, sections, dryRun }) => {
        try {
          analyticsEmitter.trackPlatformActivity({
            userId: actor.userId,
            userEmail: actor.email,
            userDisplayName: actor.displayName ?? "",
            action: "settings.imported",
            properties: { schemaVersion, aggregateStatus, dryRun, sections },
          });
        } catch (err) {
          logger.warn(
            { err: (err as Error).message, actor: actor.userId },
            "settings.imported activity emit failed (swallowed)",
          );
        }
      },
    },
  });

  // ---- Domain: Quota (per-user playground / skill-gen counters + admin grants) ----
  const quotaRepo = new QuotaRepository(db);
  void quotaRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "quota indexes ensureIndexes failed — proceeding anyway"),
  );

  // ---- Domain: Redemption codes (single-use admin-issued quota grants) ----
  const redemptionCodeRepo = new RedemptionCodeRepository(db);
  void redemptionCodeRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "redemption_codes indexes ensureIndexes failed — proceeding anyway"),
  );
  const quotaService = new QuotaService({
    repo: quotaRepo,
    defaults: {
      getQuotaDefaults: async () => {
        const [pg, sg] = await Promise.all([
          settingsService.getPlayground(),
          settingsService.getSkillGen(),
        ]);
        return {
          defaultPlaygroundMonthly: pg.defaultMonthlyQuota,
          defaultSkillGenMonthly: sg.defaultMonthlyQuota,
        };
      },
    },
    notificationService,
  });
  const quotaRoutes = createQuotaRoutes({
    quotaService,
  });

  // ---- Per-provider model catalog migration (#270) ----
  // Fold the standalone `models` collection into `llm_providers.models[]`
  // arrays. One-time, idempotent — see `migration.ts`. Must run before
  // any consumer of `LlmProvidersService.resolveModel` (playground,
  // skill-gen) hits the wire, but the call is sync-safe because no
  // route handlers are mounted yet at this point in bootstrap.
  await migrateModelCatalogIntoProviders(db).catch((err) =>
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "model-catalog migration failed — providers will read pre-migration shape via the repo's normalize shim, no data loss",
    ),
  );

  // The picker route — `GET /me/models?surface=...` — reads from the
  // per-provider arrays via `LlmProvidersService` (already constructed
  // upstream as part of `domains/settings/...`).
  const llmPickerRoutes = createLlmPickerRoutes({ llmProvidersService });

  // ---- Domain: GitHub Mirror ----
  // Single MirrorService instance — runtime-aware. Reads enabled +
  // App credentials + repo coords from `platformSettingsService` on
  // every operation, so an admin flipping the kill switch or pasting
  // new creds via the admin UI lands on the next sync without a
  // redeploy. `getActiveClient()` returns null when disabled or when
  // any required field is empty, and every public op no-ops in that
  // case — callers don't need to null-check.
  const mirrorService = new MirrorService({
    skillRepo,
    skillService,
    ornnPublicOrigin: config.ornnPublicOrigin,
    platformSettingsService,
  });
  const mirrorRoutes = createMirrorRoutes({
    mirrorService,
    platformSettingsService,
    skillRepo,
  });

  // Skill routes — sharing is now a direct PUT /permissions write; the
  // audit signal is surfaced as a per-version label, not a gate.
  const skillRoutes = createSkillRoutes({
    skillService,
    skillRepo,
    analyticsService,
    analyticsEmitter,
    maxFileSize: config.maxPackageSizeBytes,
    nyxidServiceClient,
    // Resolved from settings (`extras` section) on demand. Routes that
    // need a one-shot snapshot adapt around the async — most consumers
    // already call this resolver, so the mutable adapter is a thin
    // wrapper here.
    extraNyxidServicesResolver: () => resolveExtraNyxidServiceNames(),
    mirrorService,
  });

  // ---- Domain: Skill Search ----
  const searchService = new SearchService({
    skillRepo,
    llmClient: nyxLlmClient,
    // Default model resolves through the playground surface (search is
    // a playground-flavoured LLM call). Backend-eng-2 may add a
    // dedicated `search` section later; until then, share with playground.
    defaultModelResolver: async () =>
      (await resolveSurfaceDefaults("playground")).model,
  });

  const searchRoutes = createSearchRoutes({
    searchService,
    skillRepo,
  });

  // ---- Domain: Skill Generation ----
  const generationService = new SkillGenerationService({
    llmClient: nyxLlmClient,
    defaultsResolver: async () => resolveSurfaceDefaults("skillGen"),
  });

  const generationRoutes = createGenerationRoutes({
    generationService,
    keepAliveIntervalMsResolver: async () =>
      (await settingsService.getSkillGen()).sseKeepAliveMs,
    quotaService,
    llmProvidersService,
  });

  // ---- Domain: Playground ----
  const chatService = new PlaygroundChatService({
    llmClient: nyxLlmClient,
    sandboxClient,
    skillService,
    defaultsResolver: async () => resolveSurfaceDefaults("playground"),
  });

  const playgroundRoutes = createPlaygroundRoutes({
    chatService,
    keepAliveIntervalMsResolver: async () =>
      (await settingsService.getPlayground()).sseKeepAliveMs,
    analyticsService,
    skillService,
    quotaService,
    llmProvidersService,
  });

  // ---- Domain: Admin ----
  const adminRoutes = createAdminRoutes({
    analyticsEmitter,
    userDirectoryRepo,
    skillRepo,
    skillService,
    skillVersionRepo,
    generationService,
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
      // Lazy user-directory upsert: every authenticated request refreshes
      // the user's row in the directory. Replaces the old admin-only
      // `admin_users` cache (issue #271). Fire-and-forget; failure is
      // logged inside the repo and never bubbles up.
      onAuthSeen: (auth) => {
        void userDirectoryRepo.upsert({
          userId: auth.userId,
          email: auth.email,
          displayName: auth.displayName,
          isAdmin: auth.permissions.includes("ornn:admin:skill"),
        });
      },
    }),
  );
  // Per-request analytics — emits `api.request` to PostHog with caller,
  // method, path, status, durationMs, sourceIp, requestId. Mount AFTER
  // `proxyAuthSetup` so `c.var.auth` is populated (issue #271).
  apiApp.use(
    "*",
    apiRequestTrackingMiddleware({ emitter: analyticsEmitter }),
  );
  // Lazy, per-request memoized org lookup. Mounted once here so every domain
  // route sees the same cached result — avoids re-querying NyxID within a
  // single request even when multiple routes call `readUserOrgMemberships`.
  apiApp.use("*", nyxidOrgLookupMiddleware(nyxidOrgsClient));

  // ---- Admin routes (engineer-1): dashboard, users, quota admin ----
  const adminDashboardService = new AdminDashboardService({
    db,
    userDirectoryRepo,
  });
  const adminDashboardRoutes = createAdminDashboardRoutes({
    dashboardService: adminDashboardService,
  });
  const adminUsersService = new AdminUsersService({
    db,
    userDirectoryRepo,
  });
  const adminUsersRoutes = createAdminUsersRoutes({ adminUsersService });
  const adminQuotaRoutes = createAdminQuotaRoutes({
    quotaService,
    userDirectoryRepo,
  });
  const redemptionCodeService = new RedemptionCodeService({
    repo: redemptionCodeRepo,
    quotaService,
  });
  const adminRedemptionCodesRoutes = createAdminRedemptionCodesRoutes({
    redemptionCodeService,
  });
  const meRedemptionCodesRoutes = createMeRedemptionCodesRoutes({
    redemptionCodeService,
  });

  apiApp.route("/", skillRoutes);
  apiApp.route("/", mirrorRoutes);
  apiApp.route("/", auditRoutes);
  apiApp.route("/", notificationRoutes);
  apiApp.route("/", announcementRoutes);
  apiApp.route("/", analyticsRoutes);
  apiApp.route("/", searchRoutes);
  apiApp.route("/", generationRoutes);
  apiApp.route("/", playgroundRoutes);
  apiApp.route("/", adminRoutes);
  apiApp.route("/", adminDashboardRoutes);
  apiApp.route("/", adminUsersRoutes);
  apiApp.route("/", adminQuotaRoutes);
  apiApp.route("/", adminRedemptionCodesRoutes);
  apiApp.route("/", platformSettingsRoutes);
  apiApp.route("/", settingsRoutes);
  apiApp.route("/", llmProvidersRoutes);
  apiApp.route("/", settingsExportImportRoutes);
  apiApp.route("/", quotaRoutes);
  apiApp.route("/", meRedemptionCodesRoutes);
  apiApp.route("/", llmPickerRoutes);
  apiApp.route("/", formatRoutes);
  apiApp.route("/", createMeRoutes({
    nyxidBaseUrlResolver: async () =>
      (await settingsService.getNyxid()).baseApiUrl,
    skillRepo,
    userDirectoryRepo,
    analyticsEmitter,
    nyxidServiceClient,
    extraNyxidServicesResolver: () =>
      resolveExtraNyxidServiceNames(),
  }));
  apiApp.route("/", createUserRoutes({ userDirectoryRepo }));
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
