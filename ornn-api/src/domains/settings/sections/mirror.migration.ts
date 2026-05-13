/**
 * One-shot boot migration: copy the legacy
 * `platform_settings:{ _id: "ornn" }.githubMirror` field into the new
 * per-section `platform_settings:{ _id: "mirror" }` doc consumed by
 * `SettingsService`.
 *
 * Idempotent. Re-runs are no-ops in two cases:
 *   1. The new `mirror` section doc already exists (admin has saved it,
 *      or a previous migration run already ran). We do NOT overwrite —
 *      treating any pre-existing new doc as authoritative protects
 *      operators who deliberately saved an empty MirrorSection.
 *   2. The legacy doc has no `githubMirror` field (e.g. fresh cluster).
 *
 * Crypto: `appPrivateKey` is stored as AES-256-GCM ciphertext on both
 * sides, derived from the same `ENCRYPTION_KEY`. We copy the ciphertext
 * byte-for-byte without going through encrypt/decrypt — round-tripping
 * would just produce a different IV. Failure to decrypt later (e.g.,
 * key rotation drift) degrades to "no key set" via the existing
 * `SettingsServiceImpl.loadSection` fallback.
 *
 * @module domains/settings/sections/mirror.migration
 */

import type { Db, Document } from "mongodb";
import type pino from "pino";

const LEGACY_DOC_ID = "ornn";
const NEW_DOC_ID = "mirror";

interface LegacyMirrorShape {
  enabled?: boolean;
  owner?: string;
  repo?: string;
  branch?: string;
  appId?: string;
  installationId?: string;
  /** Already-encrypted ciphertext (AES-256-GCM). */
  appPrivateKey?: string;
}

export async function migrateLegacyMirrorIntoSettings(
  db: Db,
  logger: pino.Logger,
): Promise<void> {
  const coll = db.collection("platform_settings");

  const existingNew = await coll.findOne({
    _id: NEW_DOC_ID as unknown as Document["_id"],
  });
  if (existingNew) {
    logger.debug(
      { docId: NEW_DOC_ID },
      "mirror migration: new section doc already present — skipping",
    );
    return;
  }

  const legacy = (await coll.findOne({
    _id: LEGACY_DOC_ID as unknown as Document["_id"],
  })) as (Document & { githubMirror?: LegacyMirrorShape }) | null;
  if (!legacy?.githubMirror || typeof legacy.githubMirror !== "object") {
    logger.info(
      "mirror migration: no legacy githubMirror field — nothing to migrate",
    );
    return;
  }

  const m = legacy.githubMirror;
  const value = {
    enabled: typeof m.enabled === "boolean" ? m.enabled : false,
    owner: typeof m.owner === "string" ? m.owner : "",
    repo: typeof m.repo === "string" ? m.repo : "",
    branch: typeof m.branch === "string" ? m.branch : "",
    appId: typeof m.appId === "string" ? m.appId : "",
    installationId: typeof m.installationId === "string" ? m.installationId : "",
    appPrivateKey: typeof m.appPrivateKey === "string" ? m.appPrivateKey : "",
  };

  const now = new Date();
  await coll.updateOne(
    { _id: NEW_DOC_ID as unknown as Document["_id"] },
    {
      $set: {
        value,
        updatedAt: now,
        updatedBy: "system:legacy-mirror-migration",
      },
      $setOnInsert: { _id: NEW_DOC_ID, createdAt: now },
    },
    { upsert: true },
  );
  logger.info(
    {
      owner: value.owner,
      repo: value.repo,
      enabled: value.enabled,
      hasAppKey: !!value.appPrivateKey,
    },
    "mirror migration: copied legacy githubMirror -> settings.mirror",
  );
}
