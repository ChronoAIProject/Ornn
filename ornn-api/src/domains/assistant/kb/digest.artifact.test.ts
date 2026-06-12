/**
 * UT-KB-ARTIFACT-* — guard tests on the COMMITTED digest artifact (#970).
 *
 * These assert the build output that actually ships: it must exist, be
 * non-empty, stay within budget, hide its provenance header from the
 * model, carry Ornn-identity grounding, and contain no secret-shaped
 * content. Regenerate via `bun run build:assistant-kb` if these fail
 * after editing the source manifest or docs.
 *
 * @module domains/assistant/kb/digest.artifact.test
 */

import { describe, expect, it } from "bun:test";
import { AssistantKbLoader, defaultDigestReader } from "./loader";
import { DEFAULT_KB_TOKEN_BUDGET } from "./tokens";

describe("committed digest artifact", () => {
  it("UT-KB-ARTIFACT-001: ships, is non-empty, within budget, and grounded", () => {
    const loader = new AssistantKbLoader({ readDigest: defaultDigestReader });
    const kb = loader.load();
    expect(kb.text.length).toBeGreaterThan(2_000);
    expect(kb.estimatedTokens).toBeLessThanOrEqual(DEFAULT_KB_TOKEN_BUDGET);
    // Provenance header must not leak into the grounding.
    expect(kb.text).not.toContain("GENERATED FILE");
    // Sanity: the digest actually carries Ornn-identity grounding.
    expect(kb.text.toLowerCase()).toContain("ornn");
    expect(kb.text.toLowerCase()).toContain("skill");
  });

  it("UT-KB-ARTIFACT-002: carries no obvious secret-shaped content", () => {
    const loader = new AssistantKbLoader({ readDigest: defaultDigestReader });
    const text = loader.load().text;
    // Docs-only digest: assert none of the secret-ish markers leaked in.
    for (const needle of [
      "BEGIN PRIVATE KEY",
      "BEGIN RSA",
      "clientSecret",
    ]) {
      expect(text.includes(needle)).toBe(false);
    }
  });
});
