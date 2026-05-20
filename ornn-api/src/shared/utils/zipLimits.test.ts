/**
 * Tests for backend zip-bomb defense (#633).
 *
 * Each test builds a precisely-shaped ZIP via JSZip and asserts the
 * cap's failure mode. The thresholds are passed via the config arg
 * so we can use small, fast fixtures (a 100-byte payload tripping a
 * 50-byte cap exercises the same code path as a 50 MB payload
 * tripping the 50 MiB default).
 *
 * @module shared/utils/zipLimits.test
 */

import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { AppError } from "../types/index";
import {
  DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES,
  enforceZipLimits,
} from "./zipLimits";

/**
 * Build a deflate-compressed ZIP with the given entries. Real
 * compression so the central-directory `uncompressedSize` field is
 * actually populated — `STORE` mode would set compressed == uncompressed
 * and make the ratio check meaningless.
 */
async function buildZip(entries: Record<string, Uint8Array | string>): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [path, data] of Object.entries(entries)) {
    z.file(path, data, { compression: "DEFLATE" });
  }
  return new Uint8Array(await z.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

async function expectAppError(
  promise: Promise<unknown>,
  expected: { status: number; code: string; messagePattern?: RegExp },
): Promise<AppError> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(AppError);
  const err = caught as AppError;
  expect(err.statusCode).toBe(expected.status);
  expect(err.code).toBe(expected.code);
  if (expected.messagePattern) expect(err.message).toMatch(expected.messagePattern);
  return err;
}

describe("enforceZipLimits (#633)", () => {
  test("happy path: small valid ZIP passes through", async () => {
    const zip = await buildZip({
      "skill/SKILL.md": "---\nname: hello\n---\nbody",
    });
    await expect(enforceZipLimits(zip)).resolves.toBeUndefined();
  });

  test("rejects a non-ZIP buffer with 400 invalid_zip", async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    await expectAppError(enforceZipLimits(garbage), {
      status: 400,
      code: "invalid_zip",
      messagePattern: /not a valid ZIP/,
    });
  });

  test("rejects when cumulative uncompressed exceeds the cap", async () => {
    // Two entries each 600 bytes uncompressed; cap is 1000.
    const payload = "x".repeat(600);
    const zip = await buildZip({
      "skill/SKILL.md": payload,
      "skill/assets/big.txt": payload,
    });
    await expectAppError(
      enforceZipLimits(zip, { maxTotalUncompressedBytes: 1000 }),
      {
        status: 413,
        code: "uncompressed_too_large",
        messagePattern: /uncompressed size exceeds/,
      },
    );
  });

  test("rejects when a single entry exceeds the per-entry cap", async () => {
    const payload = "x".repeat(2000);
    const zip = await buildZip({
      "skill/SKILL.md": "ok",
      "skill/assets/oversized.txt": payload,
    });
    await expectAppError(
      enforceZipLimits(zip, {
        maxTotalUncompressedBytes: 10_000, // total fits
        maxEntryUncompressedBytes: 1000,   // but the entry doesn't
      }),
      {
        status: 413,
        code: "uncompressed_too_large",
        messagePattern: /oversized\.txt.*per-entry limit/,
      },
    );
  });

  test("rejects when file count exceeds the cap", async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      entries[`skill/assets/f${i}.txt`] = `content-${i}`;
    }
    const zip = await buildZip(entries);
    await expectAppError(
      enforceZipLimits(zip, { maxFileCount: 10 }),
      {
        status: 413,
        code: "too_many_files",
        messagePattern: /50 files; limit is 10/,
      },
    );
  });

  test("rejects on classic zip-bomb compression ratio", async () => {
    // 80 KiB of zeros — deflates to <100 bytes (>1000× ratio).
    // Compressed buffer must clear the 4 KB ratio-check floor.
    const zeros = new Uint8Array(80 * 1024);
    // Add filler so the compressed buffer crosses the 4 KB floor.
    const filler = new Uint8Array(8 * 1024);
    crypto.getRandomValues(filler);
    const zip = await buildZip({
      "skill/SKILL.md": "tiny",
      "skill/assets/zeros.bin": zeros,
      "skill/assets/filler.bin": filler,
    });
    await expectAppError(
      enforceZipLimits(zip, {
        // Generous cumulative + per-entry caps so the ratio is what fires.
        maxTotalUncompressedBytes: 10 * 1024 * 1024,
        maxEntryUncompressedBytes: 5 * 1024 * 1024,
        maxFileCount: 100,
        maxCompressionRatio: 5,
      }),
      {
        status: 413,
        code: "uncompressed_too_large",
        messagePattern: /compression ratio.*exceeds.*zip-bomb signature/,
      },
    );
  });

  test("tiny ZIP skips the ratio check (header overhead would false-positive)", async () => {
    // A few-byte ZIP has a high apparent ratio (header dominates) but
    // poses zero risk. The ratio-check floor (4 KB compressed) means
    // this passes — only the cumulative cap matters here.
    const zip = await buildZip({
      "skill/SKILL.md": "x".repeat(2000),
    });
    await expect(
      enforceZipLimits(zip, {
        maxTotalUncompressedBytes: 10_000,
        maxCompressionRatio: 1.1, // would trip if the ratio check ran
      }),
    ).resolves.toBeUndefined();
  });

  test("defaults: 50 MiB / 25 MiB / 1000 files — sanity check the constants", async () => {
    // Verify the exported constant is what the issue scope said.
    expect(DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES).toBe(50 * 1024 * 1024);
  });
});
