/**
 * Tests for the AgentSeal scanner.
 *
 * - `parseSkillScanOutput` is unit-tested against representative wrapper-script shapes.
 * - Subprocess plumbing is exercised by pointing `python` at a small
 *   shell shim that emits canned JSON, so we don't need agentseal on
 *   the test machine.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { AgentSealScanner, assertAbsoluteExistingFile, parseSkillScanOutput } from "./index";

// #442 added boot-time path validation that requires `script` to be
// an absolute path to an existing file. The subprocess tests below
// pass a shell shim as `python` (it ignores the script arg), so we
// need a real-on-disk dummy script file the validator can stat.
const DUMMY_SCRIPT = "/tmp/agentseal-test-dummy.py";

beforeAll(async () => {
  await Bun.write(DUMMY_SCRIPT, "# dummy — never actually executed; shim shells ignore script arg\n");
});

describe("parseSkillScanOutput", () => {
  test("parses canonical wrapper output with score + findings", () => {
    const raw = JSON.stringify({
      score: 92,
      findings: [{ code: "SKILL-001", severity: "low", title: "hi" }],
      agentsealVersion: "agentseal-0.9.6",
      scannedAt: "2026-05-05T00:00:00.000Z",
    });
    const parsed = parseSkillScanOutput(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.score).toBe(92);
    expect(parsed!.findings).toHaveLength(1);
    expect(parsed!.agentsealVersion).toBe("agentseal-0.9.6");
    expect(parsed!.scannedAt).toBe("2026-05-05T00:00:00.000Z");
  });

  test("clamps scores into [0, 100] and rounds floats", () => {
    expect(parseSkillScanOutput(JSON.stringify({ score: 142, findings: [], agentsealVersion: "x" }))!.score).toBe(100);
    expect(parseSkillScanOutput(JSON.stringify({ score: -5, findings: [], agentsealVersion: "x" }))!.score).toBe(0);
    expect(parseSkillScanOutput(JSON.stringify({ score: 87.6, findings: [], agentsealVersion: "x" }))!.score).toBe(88);
  });

  test("filters non-object findings", () => {
    const raw = JSON.stringify({
      score: 60,
      findings: [{ code: "ok" }, "bad", null, { code: "ok2" }],
      agentsealVersion: "x",
    });
    const parsed = parseSkillScanOutput(raw)!;
    expect(parsed.findings).toHaveLength(2);
  });

  test("returns null on garbage", () => {
    expect(parseSkillScanOutput("not-json")).toBeNull();
    expect(parseSkillScanOutput("")).toBeNull();
    expect(parseSkillScanOutput(JSON.stringify({ findings: [] }))).toBeNull(); // no score
  });

  test("returns null when wrapper signals an error", () => {
    expect(parseSkillScanOutput(JSON.stringify({ error: "bad zip" }))).toBeNull();
  });

  test("agentsealVersion falls back to 'unknown' when absent", () => {
    const parsed = parseSkillScanOutput(JSON.stringify({ score: 30, findings: [] }))!;
    expect(parsed.agentsealVersion).toBe("unknown");
  });
});

describe("AgentSealScanner.scan", () => {
  test("returns null when disabled", async () => {
    const scanner = new AgentSealScanner({
      python: "/bin/sh",
      script: "/dev/null",
      timeoutMs: 1000,
      enabled: false,
    });
    const result = await scanner.scan({
      skillGuid: "g1",
      version: "1.0",
      zipBuffer: new Uint8Array([1, 2, 3]),
    });
    expect(result).toBeNull();
  });

  test("parses output from a shim subprocess and stamps scannedAt", async () => {
    // Use a small shell shim as the "python" binary. It ignores the
    // script + zip-path args and emits canned JSON.
    const script = "/tmp/agentseal-shim-success.sh";
    await Bun.write(
      script,
      [
        "#!/bin/sh",
        'echo \'{"score": 73, "findings": [{"code": "demo"}], "agentsealVersion": "agentseal-0.9.6", "scannedAt": "2026-05-05T00:00:00.000Z"}\'',
      ].join("\n") + "\n",
    );
    await Bun.$`chmod +x ${script}`.quiet();

    const scanner = new AgentSealScanner({
      python: script,
      script: DUMMY_SCRIPT,
      timeoutMs: 5000,
      enabled: true,
    });
    const result = await scanner.scan({
      skillGuid: "g2",
      version: "1.1",
      zipBuffer: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    });
    expect(result).not.toBeNull();
    expect(result!.score).toBe(73);
    expect(result!.findings).toHaveLength(1);
    expect(result!.agentsealVersion).toBe("agentseal-0.9.6");
    expect(typeof result!.scannedAt).toBe("string");
    expect(new Date(result!.scannedAt).getTime()).toBeGreaterThan(0);
  });

  test("returns null when subprocess exits non-zero with empty stdout", async () => {
    const script = "/tmp/agentseal-shim-fail.sh";
    await Bun.write(
      script,
      [
        "#!/bin/sh",
        'echo "agentseal: failed" >&2',
        "exit 2",
      ].join("\n") + "\n",
    );
    await Bun.$`chmod +x ${script}`.quiet();

    const scanner = new AgentSealScanner({
      python: script,
      script: DUMMY_SCRIPT,
      timeoutMs: 5000,
      enabled: true,
    });
    const result = await scanner.scan({
      skillGuid: "g3",
      version: "1.0",
      zipBuffer: new Uint8Array([1]),
    });
    expect(result).toBeNull();
  });

  test("returns null when wrapper emits a structured error JSON", async () => {
    const script = "/tmp/agentseal-shim-err-json.sh";
    await Bun.write(
      script,
      [
        "#!/bin/sh",
        "echo '{\"error\": \"bad zip\"}'",
        "exit 2",
      ].join("\n") + "\n",
    );
    await Bun.$`chmod +x ${script}`.quiet();

    const scanner = new AgentSealScanner({
      python: script,
      script: DUMMY_SCRIPT,
      timeoutMs: 5000,
      enabled: true,
    });
    const result = await scanner.scan({
      skillGuid: "g3b",
      version: "1.0",
      zipBuffer: new Uint8Array([1]),
    });
    expect(result).toBeNull();
  });

  test("returns null when output cannot be parsed", async () => {
    const script = "/tmp/agentseal-shim-garbage.sh";
    await Bun.write(
      script,
      ["#!/bin/sh", 'echo "not json"'].join("\n") + "\n",
    );
    await Bun.$`chmod +x ${script}`.quiet();

    const scanner = new AgentSealScanner({
      python: script,
      script: DUMMY_SCRIPT,
      timeoutMs: 5000,
      enabled: true,
    });
    const result = await scanner.scan({
      skillGuid: "g4",
      version: "1.0",
      zipBuffer: new Uint8Array([1]),
    });
    expect(result).toBeNull();
  });

  test("kills the subprocess on timeout and returns null", async () => {
    const script = "/tmp/agentseal-shim-slow.sh";
    await Bun.write(
      script,
      [
        "#!/bin/sh",
        // Sleep longer than the timeout.
        "sleep 5",
        'echo \'{"score": 50, "findings": [], "agentsealVersion": "x"}\'',
      ].join("\n") + "\n",
    );
    await Bun.$`chmod +x ${script}`.quiet();

    const scanner = new AgentSealScanner({
      python: script,
      script: DUMMY_SCRIPT,
      timeoutMs: 200,
      enabled: true,
    });
    const result = await scanner.scan({
      skillGuid: "g5",
      version: "1.0",
      zipBuffer: new Uint8Array([1]),
    });
    expect(result).toBeNull();
  }, 10_000);

  // The "interpreter does not exist" runtime path (the test previously
  // here) is now covered earlier — at construct time — by the path
  // validator added in #442. The constructor throws before `scan()`
  // can be called. See the `assertAbsoluteExistingFile` block below.
});

describe("AgentSealScanner — boot-time path validation (#442)", () => {
  test("throws when python path is relative", () => {
    expect(
      () =>
        new AgentSealScanner({
          python: "bin/python", // relative — would resolve against $PATH / cwd
          script: DUMMY_SCRIPT,
          timeoutMs: 1000,
          enabled: true,
        }),
    ).toThrow(/must be an absolute path/);
  });

  test("throws when python path does not exist", () => {
    expect(
      () =>
        new AgentSealScanner({
          python: "/nonexistent/path/to/python",
          script: DUMMY_SCRIPT,
          timeoutMs: 1000,
          enabled: true,
        }),
    ).toThrow(/does not exist/);
  });

  test("throws when script path does not exist", () => {
    expect(
      () =>
        new AgentSealScanner({
          python: "/bin/sh",
          script: "/nonexistent/script.py",
          timeoutMs: 1000,
          enabled: true,
        }),
    ).toThrow(/does not exist/);
  });

  test("throws when script path points at a directory, not a file", () => {
    expect(
      () =>
        new AgentSealScanner({
          python: "/bin/sh",
          script: "/tmp",
          timeoutMs: 1000,
          enabled: true,
        }),
    ).toThrow(/not a regular file/);
  });

  test("disabled scanner skips validation (so dev/test envs don't need real paths)", () => {
    expect(
      () =>
        new AgentSealScanner({
          python: "bin/python", // would normally fail validation
          script: "/nonexistent",
          timeoutMs: 1000,
          enabled: false,
        }),
    ).not.toThrow();
  });

  test("happy path: absolute existing files, scanner constructs cleanly", () => {
    expect(
      () =>
        new AgentSealScanner({
          python: "/bin/sh",
          script: DUMMY_SCRIPT,
          timeoutMs: 1000,
          enabled: true,
        }),
    ).not.toThrow();
  });
});

describe("assertAbsoluteExistingFile (#442 — direct unit test)", () => {
  test("empty string rejected", () => {
    expect(() => assertAbsoluteExistingFile("x", "")).toThrow(/required/);
  });

  test("absolute existing file accepted", () => {
    expect(() => assertAbsoluteExistingFile("x", DUMMY_SCRIPT)).not.toThrow();
  });
});
