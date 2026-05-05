/**
 * One-shot mirror reconciliation entry point.
 *
 * Wires up the same dependency graph as `bootstrap.ts` (mongo + skill
 * repo + skill service + GitHub mirror client) but skips the HTTP
 * server — runs `MirrorService.reconcileAll()` once and exits with
 * code 0 on success / 1 on failure.
 *
 * Used by the k8s `CronJob` (every hour) so any state the publish-time
 * webhook dropped is caught the next time the cron fires. Reads the
 * exact same env vars as the long-running pod (configmap + secret),
 * so the cron's pod spec can just `envFrom: [{ configMapRef: ornn-api
 * -config }, { secretRef: ornn-api-secret }]`.
 *
 * Run locally:
 *   GITHUB_MIRROR_ENABLED=true \
 *   GITHUB_APP_ID=... GITHUB_APP_PRIVATE_KEY=... GITHUB_APP_INSTALLATION_ID=... \
 *   GITHUB_MIRROR_REPO_OWNER=ChronoAIProject GITHUB_MIRROR_REPO_NAME=ornn-skills \
 *   MONGODB_URI=... MONGODB_DB=ornn \
 *   STORAGE_SERVICE_URL=... NYXID_SA_TOKEN_URL=... NYXID_SA_CLIENT_ID=... NYXID_SA_CLIENT_SECRET=... \
 *   NYX_LLM_GATEWAY_URL=http://placeholder SANDBOX_SERVICE_URL=http://placeholder \
 *   bun run scripts/reconcile-mirror.ts
 *
 * Many of those envs are unused by the mirror path (LLM, sandbox,
 * NyxID SA) but the shared `loadConfig()` validates them all up front.
 * The cron's pod spec gets them via the same `envFrom` so they're
 * already populated.
 *
 * @module scripts/reconcile-mirror
 */

import pino from "pino";
import { loadConfig, assertMirrorConfigComplete } from "../src/infra/config";
import { connectMongo } from "../src/infra/db/mongodb";
import { StorageClient } from "../src/clients/storageClient";
import { NyxidSaTokenProvider } from "../src/clients/nyxid/base";
import { SkillRepository } from "../src/domains/skills/crud/repository";
import { SkillVersionRepository } from "../src/domains/skills/crud/skillVersionRepository";
import { SkillService } from "../src/domains/skills/crud/service";
import { GitHubAppAuth } from "../src/domains/skills/mirror/githubAppAuth";
import { GitHubMirrorClient } from "../src/domains/skills/mirror/githubMirrorClient";
import { MirrorService } from "../src/domains/skills/mirror/mirrorService";
import { PlatformSettingsRepository } from "../src/domains/platform/repository";
import { PlatformSettingsService } from "../src/domains/platform/service";

async function main(): Promise<void> {
  const logger = pino({ level: "info" }).child({ service: "reconcile-mirror" });
  const config = loadConfig();
  assertMirrorConfigComplete(config);
  if (!config.mirror.enabled) {
    logger.warn("GITHUB_MIRROR_ENABLED=false — reconcile is a no-op. Exiting.");
    return;
  }

  const mongo = await connectMongo(config.mongodbUri, config.mongodbDb);
  try {
    const skillRepo = new SkillRepository(mongo.db);
    const skillVersionRepo = new SkillVersionRepository(mongo.db);
    await skillVersionRepo.ensureIndexes();

    const saTokenProvider = new NyxidSaTokenProvider(
      config.nyxidTokenUrl,
      config.nyxidClientId,
      config.nyxidClientSecret,
    );
    const getSaAccessToken = () => saTokenProvider.getAccessToken();
    const needsProxyAuth = config.storageServiceUrl.includes("proxy");
    const storageClient = new StorageClient(
      config.storageServiceUrl,
      needsProxyAuth ? getSaAccessToken : undefined,
    );

    const skillService = new SkillService({
      skillRepo,
      skillVersionRepo,
      storageClient,
      storageBucket: config.storageBucket,
    });

    // Same DB-backed-with-configmap-fallback wiring as the API pod.
    // Each cron run is a fresh process, so we read DB state once at
    // the start and use it for the whole reconcile.
    const platformSettingsRepo = new PlatformSettingsRepository(mongo.db);
    const platformSettingsService = new PlatformSettingsService(platformSettingsRepo, {
      githubMirror: {
        owner: config.mirror.repoOwner,
        repo: config.mirror.repoName,
        branch: config.mirror.defaultBranch,
      },
      encryptionKey: config.encryptionKey,
    });

    const auth = new GitHubAppAuth({
      appId: config.mirror.appId,
      privateKey: config.mirror.privateKey,
      installationId: config.mirror.installationId,
    });
    const github = new GitHubMirrorClient(auth, async () => {
      const cfg = await platformSettingsService.getGithubMirrorRepo();
      return { owner: cfg.owner, repo: cfg.repo, defaultBranch: cfg.branch };
    });
    const mirror = new MirrorService(
      {
        github,
        skillRepo,
        skillService,
        ornnPublicOrigin: config.ornnPublicOrigin,
        platformSettingsService,
      },
      true,
    );

    const t0 = Date.now();
    const result = await mirror.reconcileAll();
    logger.info({ ...result, durationMs: Date.now() - t0 }, "reconcile complete");
  } finally {
    await mongo.close().catch(() => {});
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("reconcile-mirror failed:", err);
  process.exit(1);
});
