/**
 * Bootstrap for the consolidated ornn-api service.
 * Wires up all domains: skills (crud/search/generation/format), playground,
 * admin, me, users. Uses NyxID auth, chrono-storage, chrono-sandbox,
 * Nyx Provider.
 * @module bootstrap
 */

import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
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

// Idempotency-Key middleware (#459). Caches state-changing-request
// responses for 24h so retries don't create duplicates.
import {
  IdempotencyKeyRepository,
  idempotencyMiddleware,
} from "./middleware/idempotency";

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

// Domain: Skillsets (#969)
import { wireSkillsets } from "./domains/skillsets/bootstrap";

// Domain: Skill Audit
import { AuditRepository } from "./domains/skills/audit/repository";
import { AuditService } from "./domains/skills/audit/service";
import { createAuditRoutes } from "./domains/skills/audit/routes";


// Domain: Notifications
import { wireNotifications } from "./domains/notifications/bootstrap";

// Domain: Announcements (landing-page popup)
import { wireAnnouncements } from "./domains/announcements/bootstrap";

// Domain: Broadcasts (admin-authored notifications, #500)
import {
  wireBroadcasts,
  wireBroadcastsRepo,
} from "./domains/broadcasts/bootstrap";

// Domain: Analytics
import { wireAnalytics } from "./domains/analytics/bootstrap";

// Domain: Skill Search
import { wireSkillSearch } from "./domains/skills/search/bootstrap";

// Domain: Skill Generation
import { wireSkillGeneration } from "./domains/skills/generation/bootstrap";

// Domain: Playground
import { wirePlayground } from "./domains/playground/bootstrap";

// Domain: Assistant (#970 — repo-aware Q&A chatbot)
import { wireAssistant } from "./domains/assistant/bootstrap";

// Domain: Admin
import { createAdminRoutes } from "./domains/admin/routes";

// Domain: Skill Format
import { createFormatRoutes } from "./domains/skills/format/routes";

// Domain: GitHub Mirror (public + system skill auto-mirror)
import { MirrorService } from "./domains/skills/mirror/mirrorService";
import { createMirrorRoutes } from "./domains/skills/mirror/routes";
import {
  createMirrorScheduler,
  type MirrorScheduler,
} from "./domains/skills/mirror/scheduler";

// Domain: Me (caller-scoped endpoints)
import { createMeRoutes } from "./domains/me/routes";

// Domain: Users (directory lookup)
import { createUserRoutes } from "./domains/users/routes";

// Domain: Platform settings (legacy single-doc — still used by mirror, audit-waiver) ----
import { wirePlatformSettings } from "./domains/platform/bootstrap";

// Domain: Settings (multi-section + LLM providers + export/import) — backend-engineer-2.
import { SettingsRepository } from "./domains/settings/repository";
import { SettingsServiceImpl } from "./domains/settings/service";
import { createSettingsRoutes } from "./domains/settings/routes";
import { migrateLegacyMirrorIntoSettings } from "./domains/settings/sections/mirror.migration";
import { LlmProvidersRepository } from "./domains/settings/llmProviders/repository";
import { LlmProvidersService } from "./domains/settings/llmProviders/service";
import { createLlmProvidersRoutes } from "./domains/settings/llmProviders/routes";
import type { ApiFormat } from "./domains/settings/llmProviders/types";
import { SettingsExporter } from "./domains/settings/exportImport/exporter";
import { SettingsImporter } from "./domains/settings/exportImport/importer";
import { createSettingsExportImportRoutes } from "./domains/settings/exportImport/routes";
import { LlmModelListClient } from "./clients/llmModelListClient";

// Domain: Quota (per-user playground / skill-gen counters + admin grants)
import { wireQuota } from "./domains/quota/bootstrap";

// Domain: Redemption codes (admin-issued single-use quota grants)
import { wireRedemptionCodes } from "./domains/redemption-codes/bootstrap";

// Domain: Admin (engineer-1): dashboard, users, quota admin.
import { wireAdmin } from "./domains/admin/bootstrap";

// LLM provider migration (#270 — fold legacy global model catalog into
// per-provider arrays). One-time, idempotent, runs before any
// LlmProvidersService consumer reads from disk.
import { migrateModelCatalogIntoProviders } from "./domains/settings/llmProviders/migration";
import { createLlmPickerRoutes } from "./domains/settings/llmProviders/routes";

// OpenAPI spec
import { buildSpec } from "./openapi/specBuilder";

// Error handler
import { AppError, buildProblemJsonBody } from "./shared/types/index";

// Shared redaction list — single source of truth for sensitive log
// fields, shared with index.ts and the createLogger factory.
import { REDACT_PATHS } from "./shared/logger";

export interface BootstrapResult {
  app: Hono;
  shutdown: () => Promise<void>;
}

/**
 * Test-only dependency overrides. Production callers pass nothing — the
 * single optional second argument lets integration tests substitute the
 * `NyxLlmClient` with an in-process fake (see `tests/mocks/llmGateway.ts`)
 * so quota-charge / per-model accounting flows run without real network
 * IO. The override, when present, replaces the single `nyxLlmClient` that
 * the playground, skill-gen, search, and audit domains all share.
 */
export interface BootstrapOverrides {
  /** Substitute the shared LLM gateway client (integration tests only). */
  llmClient?: NyxLlmClient;
}

export async function bootstrap(
  config: SkillConfig,
  overrides?: BootstrapOverrides,
): Promise<BootstrapResult> {
  const logger = pino({
    level: config.logLevel,
    ...(config.logPretty ? { transport: { target: "pino-pretty" } } : {}),
    redact: { paths: REDACT_PATHS },
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
    enabled: config.agentsealEnabled,
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

  // One-shot migration: copy any non-default mirror config from the
  // legacy `platform_settings:{_id:"ornn"}.githubMirror` field into the
  // new per-section `platform_settings:{_id:"mirror"}` doc. Idempotent;
  // no-op when the new doc already exists or the legacy field is
  // absent. Must run BEFORE the first `settingsService.getMirror()`
  // call (none happen during boot, but be defensive). Failure is
  // logged + non-fatal — operators can still set mirror config via
  // the admin UI after boot.
  await migrateLegacyMirrorIntoSettings(db, logger).catch((err) =>
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "legacy mirror migration failed — admin must re-save mirror config",
    ),
  );

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

  // ---- Idempotency-Key cache (#459). 24h TTL on `idempotency_keys`;
  // mongo's TTL monitor sweeps once a minute. Index creation is
  // fire-and-forget so a single-replica boot still comes up if the
  // monitor temporarily refuses (it'll be re-attempted on next boot).
  const idempotencyKeyRepo = new IdempotencyKeyRepository(db);
  void idempotencyKeyRepo.ensureIndexes().catch((err) =>
    logger.warn({ err }, "idempotency_keys indexes ensureIndexes failed — proceeding anyway"),
  );

  // Convenience: resolve the LLM provider for a given surface in a
  // single Promise, projecting whichever auth shape the provider uses
  // into the simpler `{ gatewayUrl, apiKey, apiFormat }` contract
  // `NyxLlmClient` speaks. `apiKey` empty means "use SA token-exchange
  // flow". `apiFormat` selects the upstream endpoint shape (#574); when
  // no provider is configured we still return a default so the type
  // shape stays narrow — the empty `gatewayUrl` is what triggers the
  // fail-closed branch downstream.
  const resolveLlmProviderForSurface = async (
    surface: "playground" | "skillGen" | "assistant",
  ): Promise<{ gatewayUrl: string; apiKey: string; apiFormat: ApiFormat }> => {
    const sec =
      surface === "playground"
        ? await settingsService.getPlayground()
        : surface === "skillGen"
          ? await settingsService.getSkillGen()
          : await settingsService.getAssistant();
    if (!sec.defaultProviderId) {
      return { gatewayUrl: "", apiKey: "", apiFormat: "responses" };
    }
    const provider = await llmProvidersService.get(sec.defaultProviderId);
    if (!provider) return { gatewayUrl: "", apiKey: "", apiFormat: "responses" };
    const apiKey = provider.auth.kind === "apiKey" ? provider.auth.apiKey : "";
    return {
      gatewayUrl: provider.gatewayUrl,
      apiKey,
      apiFormat: provider.apiFormat,
    };
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
    surface: "playground" | "skillGen" | "assistant",
  ): Promise<{ model: string; maxOutputTokens: number; temperature: number }> => {
    const sec =
      surface === "playground"
        ? await settingsService.getPlayground()
        : surface === "skillGen"
          ? await settingsService.getSkillGen()
          : await settingsService.getAssistant();
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
  const nyxLlmClient =
    overrides?.llmClient ??
    new NyxLlmClient({
      resolver: async () => resolveLlmProviderForSurface("playground"),
      saTokenProvider,
    });

  // ---- Repositories ----
  const skillRepo = new SkillRepository(db);
  await skillRepo.ensureIndexes();
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
    // Zip-bomb caps (#632) — env-driven, enforced at the ingestion
    // chokepoint so upload + GitHub pull/refresh share the same limits.
    maxPackageUncompressedBytes: config.maxPackageUncompressedBytes,
    maxEntryUncompressedBytes: config.maxEntryUncompressedBytes,
    maxPackageFileCount: config.maxPackageFileCount,
    maxCompressionRatio: config.maxCompressionRatio,
  });

  // ---- Domain: Notifications + Broadcasts ----
  // The two share a single BroadcastRepository instance: notifications
  // reads it on the merged-feed path (#500 left-join), broadcasts
  // writes through its own service on admin CRUD. Build the repo
  // first so notifications can take its reference, then wire each
  // surface's service + routes. Notifications is built before the
  // audit service so the audit pipeline can fan out completion
  // notifications.
  const { repo: broadcastRepoForNotifications } = await wireBroadcastsRepo({
    db,
    logger,
  });
  const { service: notificationService, routes: notificationRoutes } =
    await wireNotifications({
      db,
      logger,
      broadcastRepo: broadcastRepoForNotifications,
    });

  // ---- Domain: Announcements (landing-page popup, issue #307) ----
  const { routes: announcementRoutes } = await wireAnnouncements({ db, logger });

  // ---- Domain: Broadcasts (admin-authored, fan-out via notifications, #500) ----
  const { routes: broadcastRoutes } = wireBroadcasts({
    repo: broadcastRepoForNotifications,
  });

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
  const { service: analyticsService, routes: analyticsRoutes } = wireAnalytics({
    db,
    logger,
    skillService,
  });

  // ---- Domain: Platform settings (admin-editable: audit threshold, mirror config, LLM override) ----
  // Backend-engineer-2 is replacing this with a multi-section
  // `SettingsService` (one doc per section in `platform_settings`,
  // separate `llm_providers` collection). Until that lands, we adapt
  // the existing single-doc `PlatformSettings` shape into the bridge
  // contract — every field a client/route asks for is satisfied here
  // (with sensible fallbacks for sections that don't exist yet).
  const { routes: platformSettingsRoutes } = wirePlatformSettings({
    db,
    encryptionKey: config.encryptionKey,
  });

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
  const { service: quotaService, routes: quotaRoutes } = wireQuota({
    db,
    logger,
    settingsService,
    notificationService,
  });

  // ---- Domain: Redemption codes (single-use admin-issued quota grants) ----
  const {
    adminRoutes: adminRedemptionCodesRoutes,
    meRoutes: meRedemptionCodesRoutes,
  } = wireRedemptionCodes({ db, logger, quotaService });

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
  // upstream as part of `domains/settings/...`). The section-default
  // resolver (#607) lets the picker honour the per-surface
  // `defaultModelId` pin set in admin Playground / Skill-Gen settings,
  // so the picker pre-selection agrees with what the chat execute
  // path falls back to. Falls through to the per-model
  // `defaultForX` flag when no pin is configured.
  const llmPickerRoutes = createLlmPickerRoutes({
    llmProvidersService,
    sectionDefaultResolver: async (surface) => {
      const sec =
        surface === "playground"
          ? await settingsService.getPlayground()
          : await settingsService.getSkillGen();
      return sec.defaultModelId ?? null;
    },
  });

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
    settingsService,
  });
  // In-process mirror reconcile scheduler. Multi-pod-safe (Agenda's
  // per-fire row lock on `agendaJobs`); schedule is driven by
  // `settings.mirror.reconcileSchedule` and updated dynamically by the
  // scheduler's own 1-minute sync tick. Replaces the legacy k8s
  // CronJob (#437). Constructed before `createMirrorRoutes` so the
  // status endpoint can read scheduled-run history through it (#475).
  let mirrorScheduler: MirrorScheduler | null = null;
  try {
    mirrorScheduler = createMirrorScheduler({
      db,
      logger,
      mirrorService,
      settingsService,
    });
    await mirrorScheduler.start();
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "mirror scheduler failed to start — scheduled reconciles will not run on this pod",
    );
    mirrorScheduler = null;
  }
  const mirrorRoutes = createMirrorRoutes({
    mirrorService,
    settingsService,
    skillRepo,
    mirrorScheduler,
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
  // Search shares the playground surface for default-model resolution
  // (it's a playground-flavoured LLM call). Backend-eng-2 may add a
  // dedicated `search` section later; until then, share with playground.
  const { routes: searchRoutes } = wireSkillSearch({
    skillRepo,
    llmClient: nyxLlmClient,
    defaultModelResolver: async () =>
      (await resolveSurfaceDefaults("playground")).model,
    nyxidServiceClient,
    getSaAccessToken,
  });

  // ---- Domain: Skillsets (#969) ----
  // A skillset is a curated, versioned meta-package over N member skills.
  // The service injects `skillService` so member resolution + the #968
  // closure walk stay single-sourced.
  const skillsets = wireSkillsets({ db, skillService });
  await skillsets.ensureIndexes();

  // ---- Domain: Skill Generation ----
  const { service: generationService, routes: generationRoutes } =
    wireSkillGeneration({
      llmClient: nyxLlmClient,
      defaultsResolver: async () => resolveSurfaceDefaults("skillGen"),
      keepAliveIntervalMsResolver: async () =>
        (await settingsService.getSkillGen()).sseKeepAliveMs,
      quotaService,
      llmProvidersService,
    });

  // ---- Domain: Playground ----
  const { routes: playgroundRoutes } = wirePlayground({
    llmClient: nyxLlmClient,
    sandboxClient,
    skillService,
    defaultsResolver: async () => resolveSurfaceDefaults("playground"),
    keepAliveIntervalMsResolver: async () =>
      (await settingsService.getPlayground()).sseKeepAliveMs,
    analyticsService,
    quotaService,
    llmProvidersService,
  });

  // ---- Domain: Assistant (#970) ----
  // Repo-aware Q&A chatbot. Reuses the shared NyxLlmClient, the assistant
  // LLM surface (resolver + quota), and a visibility-scoped retrieval over
  // the same SkillRepository. Pure Q&A — no agentic tool loop.
  const { routes: assistantRoutes } = wireAssistant({
    llmClient: nyxLlmClient,
    skillRepo,
    quotaService,
    llmProvidersService,
    defaultsResolver: async () => resolveSurfaceDefaults("assistant"),
    keepAliveIntervalMsResolver: async () =>
      (await settingsService.getAssistant()).sseKeepAliveMs,
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

  // Global error handler — emits RFC 7807 `application/problem+json`
  // per CONVENTIONS.md §1.3 (#456). The legacy `{ data, error }`
  // envelope is gone; clients read fields at the body root now (`code`,
  // `status`, `detail`, `title`, `type`, `instance`, `requestId`).
  app.onError((err, c) => {
    const requestId = getRequestId(c);
    const authCtx = (c.get as (k: string) => unknown)("auth") as
      | { userId?: string }
      | undefined;
    const userId = authCtx?.userId ?? null;

    const appError = err instanceof AppError ? err : null;
    const statusCode = appError?.statusCode ?? 500;
    const code = appError?.code ?? "internal_error";
    const detail = appError ? appError.message : "Internal server error";

    if (appError) {
      logger.warn({ requestId, code, status: statusCode }, appError.message);
    } else {
      logger.error({ requestId, err }, "Unhandled error");
    }

    // 5xx errors (AppError or unhandled crash) feed PostHog so runtime
    // crashes and `AppError.serviceUnavailable`-class failures land in
    // the same dashboard.
    if (statusCode >= 500) {
      analyticsEmitter.trackApiError({
        userId,
        statusCode,
        errorCode: code,
        method: c.req.method,
        path: c.req.path,
        requestId,
      });
    }

    const body = buildProblemJsonBody({
      statusCode,
      code,
      message: detail,
      instance: c.req.path,
      requestId,
    });
    return c.json(body, statusCode as ContentfulStatusCode, {
      "Content-Type": "application/problem+json",
    });
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

  // Idempotency-Key replay cache (#459). Mounted AFTER `proxyAuthSetup`
  // so it can scope cache entries per `auth.userId` — without that, two
  // unrelated callers using the same key would replay each other's
  // response. Non-mutating methods (GET/HEAD/OPTIONS) and requests
  // without an `Idempotency-Key` header are passed through untouched.
  apiApp.use("*", idempotencyMiddleware({ repo: idempotencyKeyRepo }));

  // ---- Admin routes (engineer-1): dashboard, users, quota admin ----
  const {
    dashboardRoutes: adminDashboardRoutes,
    usersRoutes: adminUsersRoutes,
    quotaRoutes: adminQuotaRoutes,
  } = wireAdmin({ db, userDirectoryRepo, quotaService });
  apiApp.route("/", skillRoutes);
  apiApp.route("/", skillsets.routes);
  apiApp.route("/", skillsets.searchRoutes);
  apiApp.route("/", mirrorRoutes);
  apiApp.route("/", auditRoutes);
  apiApp.route("/", notificationRoutes);
  apiApp.route("/", announcementRoutes);
  apiApp.route("/", broadcastRoutes);
  apiApp.route("/", analyticsRoutes);
  apiApp.route("/", searchRoutes);
  apiApp.route("/", generationRoutes);
  apiApp.route("/", playgroundRoutes);
  apiApp.route("/", assistantRoutes);
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
  const livenessHandler = (c: Context) =>
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
    // Stop the scheduler first so no new mirror reconciles start while
    // we're tearing the Mongo connection down. `stop()` is idempotent +
    // already swallows its own errors.
    if (mirrorScheduler) {
      try {
        await mirrorScheduler.stop();
      } catch (err) {
        logger.warn({ err }, "Mirror scheduler stop failed — continuing");
      }
    }
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
