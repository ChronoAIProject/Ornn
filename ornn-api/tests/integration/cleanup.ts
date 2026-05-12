/**
 * Per-test cleanup helper for integration tests against the in-memory
 * Mongo harness. Tests `beforeEach(() => resetCollections(db, [...]))`
 * to wipe only the collections the test touches, avoiding the cost of
 * tearing down + reseeding the whole `mongodb-memory-server`.
 *
 * @module tests/integration/cleanup
 */

import type { Db } from "mongodb";

/**
 * Drop every document from each named collection. Skips collections
 * that don't exist yet (a fresh harness lazily creates them on first
 * write — calling `deleteMany` on a not-yet-created namespace is a
 * no-op in the driver, but we still guard for clarity).
 */
export async function resetCollections(
  db: Db,
  names: ReadonlyArray<string>,
): Promise<void> {
  await Promise.all(
    names.map(async (name) => {
      try {
        await db.collection(name).deleteMany({});
      } catch (err) {
        // Surface unexpected failures so a typo in a test doesn't
        // silently skip the wipe and leak state across cases.
        throw new Error(
          `resetCollections: failed to clear '${name}': ${(err as Error).message}`,
        );
      }
    }),
  );
}
