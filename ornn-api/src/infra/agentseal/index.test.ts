/**
 * Tests for the AgentSeal scanner.
 *
 * - `parseGuardOutput` is unit-tested against representative CLI shapes.
 * - Subprocess plumbing is exercised by pointing `command` at a small
 *   shell helper (`/bin/sh -c "..."`) so we don't need the real
 *   `agentseal` binary on the test machine.
 */

import { describe, expect, test } from "bun:test";
import { AgentSealScanner, parseGuardOutput } from "./index";

describe("parseGuardOutput", () => {
  test("parses canonical CLI output with score + findings", () => {
    const raw = JSON.stringify({
      score: 92,
      findings: [{ rule: "extraction", severity: "low", message: "hi" }],
      agentsealVersion: "0.5.0",
    });
    const parsed = parseGuardOutput(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.score).toBe(92);
    expect(parsed!.findings).toHaveLength(1);
    expect(parsed!.agentsealVersion).toBe("0.5.0");
  });

  test("accepts trustScore as a fallback key", () => {
    const raw = JSON.stringify({ trustScore: 78, findings: [], version: "0.4.2" });
    const parsed = parseGuardOutput(raw)!;
    expect(parsed.score).toBe(78);
    expect(parsed.agentsealVersion).toBe("0.4.2");
  });

  test("clamps scores into [0, 100] and rounds floats", () => {
    expect(parseGuardOutput(JSON.stringify({ score: 142, findings: [], agentsealVersion: "x" }))!.score).toBe(100);
    expect(parseGuardOutput(JSON.stringify({ score: -5, findings: [], agentsealVersion: "x" }))!.score).toBe(0);
    expect(parseGuardOutput(JSON.stringify({ score: 87.6, findings: [], agentsealVersion: "x" }))!.score).toBe(88);
  });

  test("strips ```json fences", () => {
    const raw = "```json\n" + JSON.stringify({ score: 50, findings: [], agentsealVersion: "x" }) + "\n```";
    const parsed = parseGuardOutput(raw)!;
    expect(parsed.score).toBe(50);
  });

  test("filters non-object findings", () => {
    const raw = JSON.stringify({
      score: 60,
      findings: [{ rule: "ok" }, "bad", null, { rule: "ok2" }],
      agentsealVersion: "x",
    });
    const parsed = parseGuardOutput(raw)!;
    expect(parsed.findings).toHaveLength(2);
  });

  test("returns null on garbage", () => {
    expect(parseGuardOutput("not-json")).toBeNull();
    expect(parseGuardOutput("")).toBeNull();
    expect(parseGuardOutput(JSON.stringify({ findings: [] }))).toBeNull(); // no score
  });

  test("agentsealVersion falls back to 'unknown' when absent", () => {
    const parsed = parseGuardOutput(JSON.stringify({ score: 30, findings: [] }))!;
    expect(parsed.agentsealVersion).toBe("unknown");
  });
});

describe("AgentSealScanner.scan", () => {
  test("returns null when disabled", async () => {
    const scanner = new AgentSealScanner({
      command: "agentseal", // never invoked
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
    // Use /bin/sh as the binary; emit canned JSON, ignore stdin.
    // The "command" is interpreted as the binary; args are appended.
    // We trick the test by pointing at /bin/sh and prepending -c to the
    // arg list via a sub-binary that the scanner runs literally.
    //
    // Cleanest approach: write a tiny shell script that emits canned
    // JSON regardless of args/stdin, and point `command` at it.
    const script = "/tmp/agentseal-shim-success.sh";
    await Bun.write(
      script,
      [
        "#!/bin/sh",
        // Read stdin into /dev/null so we don't deadlock when the parent
        // pipes a few KB before close().
        "cat > /dev/null",
        'echo \'{"score": 73, "findings": [{"rule": "demo"}], "agentsealVersion": "0.5.0"}\'',
      ].join("\n") + "\n",
    );
    await Bun.$`chmod +x ${script}`.quiet();

    const scanner = new AgentSealScanner({
      command: script,
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
    expect(result!.agentsealVersion).toBe("0.5.0");
    expect(typeof result!.scannedAt).toBe("string");
    expect(new Date(result!.scannedAt).getTime()).toBeGreaterThan(0);
  });

  test("returns null when subprocess exits non-zero", async () => {
    const script = "/tmp/agentseal-shim-fail.sh";
    await Bun.write(
      script,
      [
        "#!/bin/sh",
        "cat > /dev/null",
        'echo "agentseal: failed" >&2',
        "exit 2",
      ].join("\n") + "\n",
    );
    await Bun.$`chmod +x ${script}`.quiet();

    const scanner = new AgentSealScanner({
      command: script,
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

  test("returns null when output cannot be parsed", async () => {
    const script = "/tmp/agentseal-shim-garbage.sh";
    await Bun.write(
      script,
      ["#!/bin/sh", "cat > /dev/null", 'echo "not json"'].join("\n") + "\n",
    );
    await Bun.$`chmod +x ${script}`.quiet();

    const scanner = new AgentSealScanner({
      command: script,
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
        "cat > /dev/null",
        // Sleep longer than the timeout.
        "sleep 5",
        'echo \'{"score": 50, "findings": [], "agentsealVersion": "0.5.0"}\'',
      ].join("\n") + "\n",
    );
    await Bun.$`chmod +x ${script}`.quiet();

    const scanner = new AgentSealScanner({
      command: script,
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

  test("returns null when binary does not exist", async () => {
    const scanner = new AgentSealScanner({
      command: "/nonexistent/path/agentseal-fake-binary",
      timeoutMs: 1000,
      enabled: true,
    });
    const result = await scanner.scan({
      skillGuid: "g6",
      version: "1.0",
      zipBuffer: new Uint8Array([1]),
    });
    expect(result).toBeNull();
  });
});
