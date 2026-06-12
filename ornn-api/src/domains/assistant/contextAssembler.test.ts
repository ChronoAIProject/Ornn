/**
 * UT-ASST-CTX-* — assembleAssistantInput (#970).
 *
 * @module domains/assistant/contextAssembler.test
 */

import { describe, expect, it } from "bun:test";
import {
  ASSISTANT_SYSTEM_PROMPT,
  assembleAssistantInput,
} from "./contextAssembler";
import type { RetrievedSkill } from "./types";

const SKILL: RetrievedSkill = {
  name: "slack-poster",
  description: "Post messages to Slack",
  tags: ["slack"],
  category: "messaging",
  createdOn: "2026-01-02T03:04:05.000Z",
  createdBy: "user-author",
};

describe("assembleAssistantInput", () => {
  it("UT-ASST-CTX-001: leads with one developer grounding message, then turns", () => {
    const { input } = assembleAssistantInput({
      kbText: "Ornn is a skill-lifecycle API.",
      skills: [SKILL],
      messages: [
        { role: "user", content: "What is Ornn?" },
        { role: "assistant", content: "It's an API." },
        { role: "user", content: "Tell me more." },
      ],
    });
    expect(input[0]!.role).toBe("developer");
    expect(input.slice(1).map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(input.length).toBe(4);
  });

  it("UT-ASST-CTX-002: grounding carries persona + KB + the safe skill fields", () => {
    const { input } = assembleAssistantInput({
      kbText: "Ornn KB body here.",
      skills: [SKILL],
      messages: [{ role: "user", content: "hi" }],
    });
    const grounding = input[0]!.content as string;
    expect(grounding).toContain(ASSISTANT_SYSTEM_PROMPT.slice(0, 30));
    expect(grounding).toContain("Ornn KB body here.");
    expect(grounding).toContain("slack-poster");
    expect(grounding).toContain("Post messages to Slack");
    expect(grounding).toContain("messaging");
    expect(grounding).toContain("user-author");
  });

  it("UT-ASST-CTX-003: empty skills → explicit 'no skills' line, no fabrication", () => {
    const { input } = assembleAssistantInput({
      kbText: "KB.",
      skills: [],
      messages: [{ role: "user", content: "hi" }],
    });
    const grounding = input[0]!.content as string;
    expect(grounding.toLowerCase()).toContain("no skills");
  });

  it("UT-ASST-CTX-004: blank KB → grounding still has persona + turns", () => {
    const { input } = assembleAssistantInput({
      kbText: "   ",
      skills: [],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(input[0]!.content).toContain(ASSISTANT_SYSTEM_PROMPT.slice(0, 30));
    expect(input.length).toBe(2);
  });

  it("UT-ASST-CTX-005: a RetrievedSkill cannot leak forbidden fields by construction", () => {
    // RetrievedSkill is the only skill shape the assembler accepts, and it
    // has no PII/secret fields. This guards the type-level boundary: even a
    // skill carrying secret-looking text in SAFE fields renders only those.
    const { input } = assembleAssistantInput({
      kbText: "",
      skills: [SKILL],
      messages: [{ role: "user", content: "hi" }],
    });
    const grounding = input[0]!.content as string;
    // None of these substrings exist anywhere because RetrievedSkill omits
    // the source document's sensitive fields entirely.
    for (const forbidden of ["@", "storageKey", "skillHash", "sharedWith"]) {
      expect(grounding.includes(forbidden)).toBe(false);
    }
  });
});
