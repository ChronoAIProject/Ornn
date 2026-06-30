/**
 * Schema tests for the skillsets domain (#969).
 *
 * Pins the member-ref grammar (reuses DEPENDS_ON_REF_REGEX), the 2..N
 * member bound, the kind enum (both values), and the nested-skillset
 * rejection.
 *
 * @module domains/skillsets/types.test
 */

import { describe, expect, it } from "bun:test";
import {
  createSkillsetSchema,
  publishSkillsetSchema,
  SKILLSET_INSTRUCTIONS_MAX,
  SKILLSET_KINDS,
} from "./types";

function baseCreate(overrides: Record<string, unknown> = {}) {
  return {
    name: "review-set",
    description: "A curated comparison set.",
    instructions: "Run pdf-tools first, then feed its output to csv-tools.",
    members: ["pdf-tools@1.0", "csv-tools@2.1"],
    ...overrides,
  };
}

describe("createSkillsetSchema — kind enum (#969)", () => {
  it("accepts both kind values", () => {
    for (const kind of SKILLSET_KINDS) {
      const parsed = createSkillsetSchema.safeParse(baseCreate({ kind }));
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.kind).toBe(kind);
    }
    expect(SKILLSET_KINDS).toEqual(["generic", "consensus-supported"]);
  });

  it("defaults kind to generic (NOT skillset/consensus)", () => {
    const parsed = createSkillsetSchema.safeParse(baseCreate());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.kind).toBe("generic");
  });

  it("rejects an unknown kind", () => {
    expect(createSkillsetSchema.safeParse(baseCreate({ kind: "skillset" })).success).toBe(false);
    expect(createSkillsetSchema.safeParse(baseCreate({ kind: "bundle" })).success).toBe(false);
  });
});

describe("createSkillsetSchema — members 2..N (#969)", () => {
  it("rejects fewer than 2 members", () => {
    const parsed = createSkillsetSchema.safeParse(baseCreate({ members: ["pdf-tools@1.0"] }));
    expect(parsed.success).toBe(false);
  });

  it("rejects zero members", () => {
    expect(createSkillsetSchema.safeParse(baseCreate({ members: [] })).success).toBe(false);
  });

  it("accepts exactly 2 members", () => {
    const parsed = createSkillsetSchema.safeParse(
      baseCreate({ members: ["pdf-tools@1.0", "csv-tools@1.0"] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts a `name@1.0` literal-version ref", () => {
    const parsed = createSkillsetSchema.safeParse(
      baseCreate({ members: ["pdf-tools@1.0", "csv-tools@2.0"] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts a `name@dist-tag` ref", () => {
    const parsed = createSkillsetSchema.safeParse(
      baseCreate({ members: ["pdf-tools@1.0", "csv-tools@stable"] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts a `guid@1.0` ref", () => {
    const parsed = createSkillsetSchema.safeParse(
      baseCreate({
        members: [
          "11111111-1111-4111-8111-111111111111@1.0",
          "pdf-tools@1.0",
        ],
      }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("createSkillsetSchema — member ref grammar (#969)", () => {
  it("rejects a semver-range ref (^1.0)", () => {
    const parsed = createSkillsetSchema.safeParse(
      baseCreate({ members: ["pdf-tools@^1.0", "csv-tools@1.0"] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects a 3-part version (1.2.3)", () => {
    const parsed = createSkillsetSchema.safeParse(
      baseCreate({ members: ["pdf-tools@1.2.3", "csv-tools@1.0"] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects a bare name with no @version", () => {
    const parsed = createSkillsetSchema.safeParse(
      baseCreate({ members: ["pdf-tools", "csv-tools@1.0"] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects a nested-skillset ref (skillset:-prefixed)", () => {
    const parsed = createSkillsetSchema.safeParse(
      baseCreate({ members: ["skillset:other-set@1.0", "csv-tools@1.0"] }),
    );
    expect(parsed.success).toBe(false);
  });
});

function basePublish(overrides: Record<string, unknown> = {}) {
  return {
    instructions: "Use member-a, then member-b for the comparison.",
    members: ["a@1.0", "b@1.0"],
    ...overrides,
  };
}

describe("publishSkillsetSchema (#1162)", () => {
  it("requires members + instructions; the revision is system-assigned (no version field)", () => {
    expect(
      publishSkillsetSchema.safeParse(basePublish({ members: undefined })).success,
    ).toBe(false); // missing members
    expect(
      publishSkillsetSchema.safeParse(basePublish({ instructions: undefined })).success,
    ).toBe(false); // missing master prompt
    // A valid publish carries NO version — the system bumps the revision.
    expect(publishSkillsetSchema.safeParse(basePublish()).success).toBe(true);
  });

  it("ignores an owner-supplied version (stripped — the system controls it)", () => {
    const parsed = publishSkillsetSchema.safeParse(basePublish({ version: "9.9" }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect("version" in parsed.data).toBe(false);
  });
});

describe("createSkillsetSchema — no owner version (#1162)", () => {
  it("ignores an owner-supplied version (stripped — create always starts at 1.0)", () => {
    const parsed = createSkillsetSchema.safeParse(baseCreate({ version: "5.0" }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect("version" in parsed.data).toBe(false);
  });
});

describe("instructions master prompt — REQUIRED on both schemas (#978)", () => {
  const longPrompt = "Step-by-step orchestration guide for the set. ".repeat(20);
  const tooLong = "x".repeat(SKILLSET_INSTRUCTIONS_MAX + 1);

  it("create accepts a valid, trimmed prompt (whitespace stripped)", () => {
    const parsed = createSkillsetSchema.safeParse(
      baseCreate({ instructions: `  ${longPrompt}  ` }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.instructions).toBe(longPrompt.trim());
  });

  it("publish accepts a valid, trimmed prompt (whitespace stripped)", () => {
    const parsed = publishSkillsetSchema.safeParse(
      basePublish({ instructions: `\n${longPrompt}\n` }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.instructions).toBe(longPrompt.trim());
  });

  it("create rejects a missing prompt", () => {
    expect(createSkillsetSchema.safeParse(baseCreate({ instructions: undefined })).success).toBe(
      false,
    );
  });

  it("publish rejects a missing prompt", () => {
    expect(publishSkillsetSchema.safeParse(basePublish({ instructions: undefined })).success).toBe(
      false,
    );
  });

  it("create rejects an empty prompt", () => {
    expect(createSkillsetSchema.safeParse(baseCreate({ instructions: "" })).success).toBe(false);
  });

  it("publish rejects an empty prompt", () => {
    expect(publishSkillsetSchema.safeParse(basePublish({ instructions: "" })).success).toBe(false);
  });

  it("create rejects a whitespace-only prompt (trims to empty)", () => {
    expect(createSkillsetSchema.safeParse(baseCreate({ instructions: "   \n\t  " })).success).toBe(
      false,
    );
  });

  it("publish rejects a whitespace-only prompt (trims to empty)", () => {
    expect(publishSkillsetSchema.safeParse(basePublish({ instructions: "   \n\t  " })).success).toBe(
      false,
    );
  });

  it(`create rejects a prompt over ${SKILLSET_INSTRUCTIONS_MAX} chars`, () => {
    expect(createSkillsetSchema.safeParse(baseCreate({ instructions: tooLong })).success).toBe(
      false,
    );
  });

  it(`publish rejects a prompt over ${SKILLSET_INSTRUCTIONS_MAX} chars`, () => {
    expect(publishSkillsetSchema.safeParse(basePublish({ instructions: tooLong })).success).toBe(
      false,
    );
  });

  it(`accepts a prompt of exactly ${SKILLSET_INSTRUCTIONS_MAX} chars`, () => {
    const exact = "y".repeat(SKILLSET_INSTRUCTIONS_MAX);
    expect(createSkillsetSchema.safeParse(baseCreate({ instructions: exact })).success).toBe(true);
    expect(publishSkillsetSchema.safeParse(basePublish({ instructions: exact })).success).toBe(
      true,
    );
  });
});
