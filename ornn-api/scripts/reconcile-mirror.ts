/**
 * One-shot mirror reconciliation entry point.
 *
 * Wires up the dependency graph (mongo + skill repo + skill service +
 * SettingsService) and runs `MirrorService.reconcileAll()` once, then
 * exits with code 0 on success / 1 on failure.
 *
 * The in-process scheduler in `ornn-api` is the production driver for
 * this work — this script remains as a manual debugging shim operators
 * can run from a developer box (e.g. to force an immediate reconcile
 * without waiting for the schedule). Mirror settings (kill switch +
 * repo coords + GitHub App credentials) live in the `platform_settings`
 * Mongo collection under the `mirror` section and are surfaced through
 * the admin UI; this script reads them via `SettingsServiceImpl` and
 * no-ops cleanly when disabled or incomplete (the same self-gating
 * code path the long-running pod uses).
 *
 * Run locally:
 *   MONGODB_URI=... MONGODB_DB=ornn ENCRYPTION_KEY=... \
 *   bun run scripts/reconcile-mirror.ts
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
import { SettingsRepository } from "../src/domains/settings/repository";
import { SettingsServiceImpl } from "../src/domains/settings/service";

async function main(): Promise<void> {
  const logger = pino({ level: "info" }).child({ service: "reconcile-mirror" });
  const config = loadConfig();

  const mongo = await connectMongo(config.mongodbUri, config.mongodbDb);
  try {
    const skillRepo = new SkillRepository(mongo.db);
    const skillVersionRepo = new SkillVersionRepository(mongo.db);
    await skillVersionRepo.ensureIndexes();

    const settingsRepo = new SettingsRepository(mongo.db);
    const settingsService = new SettingsServiceImpl({
      repo: settingsRepo,
      encryptionKey: config.encryptionKey,
    });

    const saTokenProvider = new NyxidSaTokenProvider(async () => {
      const s = await settingsService.getNyxid();
      return {
        tokenUrl: s.tokenUrl,
        clientId: s.clientId,
        clientSecret: s.clientSecret,
      };
    });
    const getSaAccessToken = () => saTokenProvider.getAccessToken();
    const storageClient = new StorageClient({
      resolver: async () => {
        const s = await settingsService.getNyxid();
        return { baseUrl: s.chronoStorageUrl, bucket: s.chronoStorageBucket };
      },
      getAccessToken: getSaAccessToken,
    });

    const skillService = new SkillService({
      skillRepo,
      skillVersionRepo,
      storageClient,
      storageBucketResolver: async () =>
        (await settingsService.getNyxid()).chronoStorageBucket,
    });

    // Self-gates on disabled/incomplete config — exits cleanly with a
    // zero-count result in either case so the manual run's exit code
    // stays 0 when the operator just wants to verify the wiring.
    const runtime = await settingsService.getMirror();
    if (!runtime.enabled) {
      logger.warn("Mirror is disabled in settings — reconcile is a no-op. Exiting.");
      return;
    }
    if (
      !runtime.appId || !runtime.installationId || !runtime.appPrivateKey ||
      !runtime.owner || !runtime.repo
    ) {
      logger.warn(
        "Mirror is enabled but credentials/coords are incomplete in settings — reconcile is a no-op. Exiting.",
      );
      return;
    }

    const mirror = new MirrorService({
      skillRepo,
      skillService,
      ornnPublicOrigin: config.ornnPublicOrigin,
      settingsService,
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
