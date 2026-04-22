/**
 * Audit script: find existing `skills` (and `categories`) whose names
 * collide with reserved API-v1 action verbs. Report-only — run this
 * before deploying the Epic 2 `/v1/` cut so any colliding rows can be
 * renamed beforehand (otherwise the canonical read endpoint for those
 * resources becomes unreachable).
 *
 * Run with (from ornn-api/):
 *   MONGODB_URI=... MONGODB_DB=... bun run audit:reserved-verbs
 *
 * Exit code:
 *   0 — no collisions
 *   1 — collisions found (rows printed to stdout)
 *
 * @module scripts/audit-reserved-verbs
 */

import { MongoClient } from "mongodb";
import { RESERVED_VERBS } from "../src/shared/reservedVerbs";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB ?? "ornn";

if (!MONGODB_URI) {
  console.error("MONGODB_URI is required");
  process.exit(1);
}

async function main(): Promise<void> {
  const client = new MongoClient(MONGODB_URI as string);
  await client.connect();
  const db = client.db(MONGODB_DB);

  console.log(`Scanning ${MONGODB_DB}...`);

  let totalCollisions = 0;

  for (const [resource, verbs] of Object.entries(RESERVED_VERBS)) {
    if (verbs.length === 0) continue;
    const collection = resource === "category" ? "categories" : `${resource}s`;
    const rows = await db
      .collection(collection)
      .find({ name: { $in: verbs as string[] } })
      .project({ _id: 1, name: 1, createdBy: 1, createdByEmail: 1, isPrivate: 1 })
      .toArray();

    if (rows.length === 0) {
      console.log(`[${collection}] 0 collisions against ${verbs.length} reserved verbs`);
      continue;
    }

    totalCollisions += rows.length;
    console.log(`[${collection}] ${rows.length} collision(s):`);
    for (const row of rows) {
      console.log(`  - name=${row.name}  _id=${row._id}  createdBy=${row.createdBy ?? "-"}  email=${row.createdByEmail ?? "-"}  isPrivate=${row.isPrivate ?? "-"}`);
    }
  }

  await client.close();

  if (totalCollisions > 0) {
    console.log(`\nFound ${totalCollisions} row(s) with reserved-verb names.`);
    console.log(`Rename these rows (coordinate with owners) before deploying the /v1/ cut.`);
    process.exit(1);
  }
  console.log(`\nNo collisions. Safe to deploy reserved-verb enforcement.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
