/**
 * Tests for the SPA stale-bundle self-recovery loop.
 *
 * @module lib/versionCheck.test
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  fetchDeployedVersion,
  getBakedVersion,
  isOutdated,
  startVersionMonitor,
} from "./versionCheck";

describe("isOutdated", () => {
  it("returns false when deployed === baked", () => {
    expect(isOutdated("0.7.4+abc1234", "0.7.4+abc1234")).toBe(false);
  });
  it("returns true when deployed differs from baked", () => {
    expect(isOutdated("0.7.5+def5678", "0.7.4+abc1234")).toBe(true);
  });
  it("returns false when deployed is null (couldn't fetch)", () => {
    expect(isOutdated(null, "0.7.4+abc1234")).toBe(false);
  });
  it("returns false in dev mode (baked === 'dev')", () => {
    expect(isOutdated("0.7.4+abc1234", "dev")).toBe(false);
  });
});

describe("fetchDeployedVersion", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns version string on 200 with valid JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ version: "0.7.4+abc1234" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await fetchDeployedVersion()).toBe("0.7.4+abc1234");
  });

  it("returns null on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 404 }),
    );
    expect(await fetchDeployedVersion()).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
    expect(await fetchDeployedVersion()).toBeNull();
  });

  it("returns null on malformed JSON (no version field)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await fetchDeployedVersion()).toBeNull();
  });

  it("returns null on empty version field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ version: "" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await fetchDeployedVersion()).toBeNull();
  });
});

describe("startVersionMonitor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fire when /version.json matches the baked version", async () => {
    // Mock fetch to return the actual baked version from this build.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: getBakedVersion() }), {
        status: 200,
      }),
    );
    const onOutdated = vi.fn();
    const handle = startVersionMonitor({ onOutdated, intervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 10));
    handle.stop();
    expect(onOutdated).not.toHaveBeenCalled();
  });

  it("fires once when /version.json reports a different version", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "0.0.0+would-never-match" }), {
        status: 200,
      }),
    );
    const onOutdated = vi.fn();
    const handle = startVersionMonitor({ onOutdated, intervalMs: 1000 });
    await new Promise((r) => setTimeout(r, 20));
    handle.stop();
    // Skip in dev mode (baked === "dev") — isOutdated short-circuits.
    if (getBakedVersion() === "dev") {
      expect(onOutdated).not.toHaveBeenCalled();
    } else {
      expect(onOutdated).toHaveBeenCalledWith("0.0.0+would-never-match");
      expect(onOutdated).toHaveBeenCalledTimes(1);
    }
  });

  it("does not fire on null fetch (network down)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const onOutdated = vi.fn();
    const handle = startVersionMonitor({ onOutdated, intervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 10));
    handle.stop();
    expect(onOutdated).not.toHaveBeenCalled();
  });

  it("stop() unsubscribes window/document listeners (no fire after stop)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "dev" }), { status: 200 }),
    );
    const onOutdated = vi.fn();
    const handle = startVersionMonitor({ onOutdated, intervalMs: 60_000 });
    handle.stop();
    // Trigger a focus event after stop — must NOT cause a fetch firing.
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 10));
    expect(onOutdated).not.toHaveBeenCalled();
  });
});
