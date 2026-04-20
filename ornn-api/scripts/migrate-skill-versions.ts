/**
 * One-shot migration: for every existing skill that pre-dates the
 * versioning feature, patch its `SKILL.md` frontmatter to carry
 * `version: "0.1"` (or whatever `metadata.version` says, when valid) and
 * republish through the API so the full versioning machinery — storage
 * upload, hash recompute, `skill_versions` row insert, `latestVersion`
 * pointer — runs through the same code path a normal publish uses.
 *
 * Why HTTP instead of direct DB + storage: the storage service hands out
 * presigned URLs pointing at an internal MinIO hostname that isn't
 * reachable from outside the cluster. Going through the API sidesteps
 * that entirely — this script can run from any host with network access
 * to `ornn-api` and an admin access token.
 *
 * Flow per skill:
 *   1. `GET /api/skills/:guid/versions` — if the list is non-empty, the
 *      skill already has at least one version row and we skip.
 *   2. `GET /api/skills/:guid/json` — returns the unpacked package
 *      (SKILL.md body + every scripts/ / references/ / assets/ file).
 *   3. Patch the SKILL.md string: insert a top-level
 *      `version: "<resolved>"` line if missing, or rewrite an existing
 *      `version:` line to the canonical quoted form.
 *   4. Re-pack into a ZIP wrapped in a `<name>/` root folder (matches
 *      the validator's expectations).
 *   5. `PUT /api/skills/:guid` with the new ZIP. The API's update flow
 *      inserts the `skill_versions` row, advances the skill doc's
 *      `latestVersion`, and writes the new storage key + hash.
 *
 * Idempotent: skills with an existing version row are skipped.
 *
 * Run with (from ornn-api/):
 *   MONGODB_URI=... MONGODB_DB=... \
 *   ORNN_API_URL=http://localhost:3802 \
 *   ORNN_ADMIN_TOKEN=<NyxID access token with ornn:admin:skill> \
 *   bun run migrate:versions
 */

import JSZip from "jszip";
import { MongoClient } from "mongodb";
import { SKILL_VERSION_REGEX } from "../src/shared/schemas/skillFrontmatter";

const DEFAULT_VERSION = "0.1";
const FRONTMATTER_REGEX = /^(---\s*\n)([\s\S]*?)(\n---)/;

function readConfig(): {
  mongoUri: string;
  mongoDb: string;
  apiBaseUrl: string;
  adminToken: string;
} {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI is required");
  const apiBaseUrl = process.env.ORNN_API_URL;
  if (!apiBaseUrl) throw new Error("ORNN_API_URL is required");
  const adminToken = process.env.ORNN_ADMIN_TOKEN;
  if (!adminToken) throw new Error("ORNN_ADMIN_TOKEN is required (must have ornn:admin:skill)");
  return {
    mongoUri,
    mongoDb: process.env.MONGODB_DB ?? "ornn",
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    adminToken,
  };
}

function resolveVersion(skillDoc: Record<string, unknown>): string {
  const candidates: unknown[] = [
    skillDoc.latestVersion,
    (skillDoc.metadata as Record<string, unknown> | undefined)?.version,
    (skillDoc as { version?: unknown }).version,
  ];
  for (const raw of candidates) {
    if (typeof raw === "string" && SKILL_VERSION_REGEX.test(raw)) return raw;
  }
  return DEFAULT_VERSION;
}

/**
 * Patch a SKILL.md string so its YAML frontmatter carries
 * `version: "<resolvedVersion>"`.
 *
 * Surgical text edit — preserves author formatting, comments, and
 * unrelated keys. Returns `{ patched: false }` when the file already has
 * the matching line or has no frontmatter block at all.
 */
export function patchSkillMdFrontmatter(
  content: string,
  resolvedVersion: string,
): { patched: boolean; newContent: string } {
  const fmMatch = content.match(FRONTMATTER_REGEX);
  if (!fmMatch) return { patched: false, newContent: content };

  const fmBody = fmMatch[2];
  const desired = `"${resolvedVersion}"`;

  const versionLineRe = /^(version:\s*)(.*)$/m;
  const existing = fmBody.match(versionLineRe);
  if (existing) {
    if (existing[2].trim() === desired) return { patched: false, newContent: content };
    const newFmBody = fmBody.replace(versionLineRe, `version: ${desired}`);
    return { patched: true, newContent: rebuildWithFmBody(content, fmMatch, newFmBody) };
  }

  let newFmBody: string;
  const insertAfter = (re: RegExp) => fmBody.replace(re, (m) => `${m}\nversion: ${desired}`);
  if (/^description:[^\n]*$/m.test(fmBody)) {
    newFmBody = insertAfter(/^description:[^\n]*$/m);
  } else if (/^name:[^\n]*$/m.test(fmBody)) {
    newFmBody = insertAfter(/^name:[^\n]*$/m);
  } else {
    newFmBody = `${fmBody.replace(/\s+$/, "")}\nversion: ${desired}`;
  }
  return { patched: true, newContent: rebuildWithFmBody(content, fmMatch, newFmBody) };
}

function rebuildWithFmBody(original: string, fmMatch: RegExpMatchArray, newFmBody: string): string {
  const start = fmMatch.index ?? 0;
  const [, openDelim, , closeDelim] = fmMatch;
  return (
    original.slice(0, start) +
    openDelim +
    newFmBody +
    closeDelim +
    original.slice(start + fmMatch[0].length)
  );
}

async function apiRequest<T>(
  method: string,
  url: string,
  token: string,
  body?: BodyInit,
  contentType?: string,
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (contentType) headers["Content-Type"] = contentType;
  const res = await fetch(url, { method, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

interface VersionsResponse {
  data: { items: Array<{ version: string }> } | null;
}

interface SkillJsonResponse {
  data: {
    name: string;
    description: string;
    metadata: Record<string, unknown>;
    files: Record<string, string>;
  } | null;
}

/**
 * Re-pack the /json response into a ZIP wrapped in a `<name>/` root folder
 * so the backend validator accepts it (it enforces a kebab-case root
 * folder that matches the skill name).
 */
async function buildZipFromJson(skillName: string, files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  const folder = zip.folder(skillName);
  if (!folder) throw new Error("failed to create root folder in zip");
  for (const [relativePath, content] of Object.entries(files)) {
    folder.file(relativePath, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

async function main(): Promise<void> {
  const config = readConfig();
  const mongo = new MongoClient(config.mongoUri);
  await mongo.connect();
  const db = mongo.db(config.mongoDb);
  const skills = db.collection("skills");

  const cursor = skills.find({});
  let scanned = 0;
  let alreadyMigrated = 0;
  let migrated = 0;
  let missingFrontmatter = 0;
  const errors: Array<{ skill: string; error: string }> = [];

  for await (const skill of cursor) {
    scanned += 1;
    const guid = skill._id as unknown as string;
    const name = (skill.name as string | undefined) ?? guid;
    const resolved = resolveVersion(skill);

    try {
      // Skip if the skill already has at least one version row.
      const versionsResp = await apiRequest<VersionsResponse>(
        "GET",
        `${config.apiBaseUrl}/api/skills/${encodeURIComponent(guid)}/versions`,
        config.adminToken,
      );
      if ((versionsResp.data?.items.length ?? 0) > 0) {
        alreadyMigrated += 1;
        continue;
      }

      // Fetch the full package as JSON.
      const jsonResp = await apiRequest<SkillJsonResponse>(
        "GET",
        `${config.apiBaseUrl}/api/skills/${encodeURIComponent(guid)}/json`,
        config.adminToken,
      );
      const bundle = jsonResp.data;
      if (!bundle) throw new Error("empty /json response");
      const skillMd = bundle.files["SKILL.md"];
      if (typeof skillMd !== "string") {
        missingFrontmatter += 1;
        continue;
      }

      const { patched, newContent } = patchSkillMdFrontmatter(skillMd, resolved);
      if (!patched) {
        // Frontmatter already has the desired version yet no DB row exists —
        // rare, but republish anyway so the DB catches up.
      }

      const nextFiles = { ...bundle.files, "SKILL.md": newContent };
      const zipBuf = await buildZipFromJson(bundle.name, nextFiles);

      // Republish through the API so the version row + hash are owned by
      // the normal update path. skip_validation is on: some legacy skills
      // may have pre-schema content that would otherwise be rejected.
      await apiRequest(
        "PUT",
        `${config.apiBaseUrl}/api/skills/${encodeURIComponent(guid)}?skip_validation=true`,
        config.adminToken,
        zipBuf as unknown as BodyInit,
        "application/zip",
      );
      migrated += 1;
    } catch (err) {
      errors.push({ skill: `${name} (${guid})`, error: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(
    [
      `Skill versions migration complete:`,
      `  scanned=${scanned}`,
      `  migrated=${migrated}`,
      `  alreadyMigrated=${alreadyMigrated}`,
      `  missingSkillMd=${missingFrontmatter}`,
    ].join("\n"),
  );

  if (errors.length > 0) {
    console.warn(`\n${errors.length} skill(s) had errors:`);
    for (const e of errors) console.warn(`  - ${e.skill}: ${e.error}`);
    process.exitCode = 1;
  }

  await mongo.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exitCode = 1;
});
