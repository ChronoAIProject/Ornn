/**
 * One-shot mirror reconciliation entry point.
 *
 * Wires up the same dependency graph as `bootstrap.ts` (mongo + skill
 * repo + skill service + platform settings) but skips the HTTP server
 * — runs `MirrorService.reconcileAll()` once and exits with code 0 on
 * success / 1 on failure.
 *
 * Used by the k8s `CronJob` (every hour) so any state the publish-time
 * webhook dropped is caught the next time the cron fires. Mirror
 * settings (kill switch + repo coords + GitHub App credentials) live
 * in the `platform_settings` Mongo collection and are surfaced through
 * the admin UI; this script reads them via `PlatformSettingsService`
 * and no-ops cleanly when disabled or incomplete (the same self-gating
 * code path the long-running pod uses).
 *
 * Run locally:
 *   MONGODB_URI=... MONGODB_DB=ornn ENCRYPTION_KEY=... \
 *   bun run scripts/reconcile-mirror.ts
 *
 * NyxID SA credentials and other operator-flippable settings live in
 * the `platform_settings` collection — the script reads them through
 * `SettingsService` and self-gates when missing.
 *
 * @module scripts/reconcile-mirror
 */

import pino from "pino";
import { loadConfig } from "../src/infra/config";
import { connectMongo } from "../src/infra/db/mongodb";
import { StorageClient } from "../src/clients/storageClient";
import { NyxidSaTokenProvider } from "../src/clients/nyxid/base";
import { SkillRepository } from "../src/domains/skills/crud/repository";
import { SkillVersionRepository } from "../src/domains/skills/crud/skillVersionRepository";
import { SkillService } from "../src/domains/skills/crud/service";
import { MirrorService } from "../src/domains/skills/mirror/mirrorService";
import { PlatformSettingsRepository } from "../src/domains/platform/repository";
import { PlatformSettingsService } from "../src/domains/platform/service";

async function main(): Promise<void> {
  const logger = pino({ level: "info" }).child({ service: "reconcile-mirror" });
  const config = loadConfig();

  const mongo = await connectMongo(config.mongodbUri, config.mongodbDb);
  try {
    const skillRepo = new SkillRepository(mongo.db);
    const skillVersionRepo = new SkillVersionRepository(mongo.db);
    await skillVersionRepo.ensureIndexes();

    const platformSettingsRepo = new PlatformSettingsRepository(mongo.db);
    const platformSettingsService = new PlatformSettingsService(platformSettingsRepo, {
      encryptionKey: config.encryptionKey,
    });
    const saTokenProvider = new NyxidSaTokenProvider(async () => {
      const s = await platformSettingsService.getNyxidIntegration();
      return {
        tokenUrl: s.tokenUrl,
        clientId: s.clientId,
        clientSecret: s.clientSecret,
      };
    });
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

    // Self-gates on disabled/incomplete config — exits cleanly with a
    // zero-count result in either case so the cron's exit code stays 0.
    const runtime = await platformSettingsService.getGithubMirrorConfig();
    if (!runtime.enabled) {
      logger.warn("Mirror is disabled in platform_settings — reconcile is a no-op. Exiting.");
      return;
    }
    if (
      !runtime.appId || !runtime.installationId || !runtime.appPrivateKey ||
      !runtime.owner || !runtime.repo
    ) {
      logger.warn(
        "Mirror is enabled but credentials/coords are incomplete in platform_settings — reconcile is a no-op. Exiting.",
      );
      return;
    }

    const mirror = new MirrorService({
      skillRepo,
      skillService,
      ornnPublicOrigin: config.ornnPublicOrigin,
      platformSettingsService,
    });

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
