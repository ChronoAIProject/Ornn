/**
 * Unit tests for the skillset derived-visibility recompute (#1136).
 *
 * The classifier depends only on a member-ref loader + two repo methods,
 * so it is exercised with in-memory fakes (no Mongo) — the loader maps a
 * ref to a public / private / unresolvable verdict, the repos record the
 * derived-visibility writes.
 *
 * @module domains/skillsets/recompute.test
 */

import { describe, expect, test } from "bun:test";
import type { ActorContext } from "../skills/crud/authorize";
import type { LoadVersion, ResolvedVersion } from "../skills/closure/resolver";
import type { SkillsetMemberVisibilityState } from "./types";
import {
  backfillDerivedVisibility,
  computeDerivedVisibility,
  computePublicResolvedMembers,
  recomputeForSkill,
  recomputeSkillsetVisibility,
  type MemberVisibilityResolver,
  type SkillsetRecomputeDeps,
} from "./recompute";

/** Member visibility fixtures keyed by exact ref. Absent ⇒ unresolvable. */
type Verdict = "public" | "private";

function makeResolver(refs: Record<string, Verdict>): MemberVisibilityResolver {
  return {
    createVersionLoader(_actor: ActorContext): LoadVersion {
      return async (ref: string): Promise<ResolvedVersion | null> => {
        const verdict = refs[ref];
        if (!verdict) return null;
        const at = ref.lastIndexOf("@");
        return {
          ref,
          name: ref.slice(0, at),
          version: ref.slice(at + 1),
          isPrivate: verdict === "private",
          dependsOn: [],
        };
      };
    },
  };
}

describe("computeDerivedVisibility", () => {
  test("all members public → all-public / true", async () => {
    const resolver = makeResolver({ "a@1.0": "public", "b@1.0": "public" });
    const result = await computeDerivedVisibility(["a@1.0", "b@1.0"], resolver);
    expect(result).toEqual({ membersAllPublic: true, memberVisibilityState: "all-public" });
  });

  test("one private member → restricted / false", async () => {
    const resolver = makeResolver({ "a@1.0": "public", "b@1.0": "private" });
    const result = await computeDerivedVisibility(["a@1.0", "b@1.0"], resolver);
    expect(result).toEqual({ membersAllPublic: false, memberVisibilityState: "restricted" });
  });

  test("one unresolvable member → unresolvable / false (dominates private)", async () => {
    // `gone@1.0` is absent from the resolver ⇒ unresolvable; even with a
    // private member present, unresolvable wins (it is the more severe state).
    const resolver = makeResolver({ "a@1.0": "private" });
    const result = await computeDerivedVisibility(["a@1.0", "gone@1.0"], resolver);
    expect(result).toEqual({ membersAllPublic: false, memberVisibilityState: "unresolvable" });
  });

  test("empty member list is vacuously all-public", async () => {
    const resolver = makeResolver({});
    const result = await computeDerivedVisibility([], resolver);
    expect(result).toEqual({ membersAllPublic: true, memberVisibilityState: "all-public" });
  });
});

describe("computePublicResolvedMembers (#1165 — public-only snapshot)", () => {
  test("includes only public, resolvable members, sorted + de-duped", async () => {
    const resolver = makeResolver({ "b@1.0": "public", "a@2.1": "public" });
    const snapshot = await computePublicResolvedMembers(["b@1.0", "a@2.1"], resolver);
    // Sorted by the canonical `name@version` string, so `a@2.1` precedes `b@1.0`.
    expect(snapshot).toEqual(["a@2.1", "b@1.0"]);
  });

  test("excludes a PRIVATE member — the export-subset signal (#1165)", async () => {
    // m3 is private: it still RESOLVES under SYSTEM but is not in the exported
    // set, so it must not appear in the snapshot. This is what makes a privacy
    // flip move the snapshot (and bump the revision) even though no version did.
    const resolver = makeResolver({ "m1@1.0": "public", "m2@1.0": "public", "m3@1.0": "private" });
    const snapshot = await computePublicResolvedMembers(["m1@1.0", "m2@1.0", "m3@1.0"], resolver);
    expect(snapshot).toEqual(["m1@1.0", "m2@1.0"]);
  });

  test("excludes an unresolvable member ref", async () => {
    const resolver = makeResolver({ "m1@1.0": "public" });
    const snapshot = await computePublicResolvedMembers(["m1@1.0", "gone@1.0"], resolver);
    expect(snapshot).toEqual(["m1@1.0"]);
  });

  test("empty when no member is public-resolvable", async () => {
    const resolver = makeResolver({ "m1@1.0": "private" });
    const snapshot = await computePublicResolvedMembers(["m1@1.0", "gone@1.0"], resolver);
    expect(snapshot).toEqual([]);
  });
});

/** Minimal in-memory repo doubles capturing the derived-visibility writes. */
function makeDeps(opts: {
  refs: Record<string, Verdict>;
  latestMembers: Record<string, string[] | null>;
  byMember?: Record<string, string[]>;
}): {
  deps: SkillsetRecomputeDeps;
  writes: Record<string, { membersAllPublic: boolean; memberVisibilityState: SkillsetMemberVisibilityState }>;
} {
  const writes: Record<
    string,
    { membersAllPublic: boolean; memberVisibilityState: SkillsetMemberVisibilityState }
  > = {};
  const deps = {
    skillService: makeResolver(opts.refs),
    skillsetRepo: {
      setDerivedVisibility: async (
        guid: string,
        derived: { membersAllPublic: boolean; memberVisibilityState: SkillsetMemberVisibilityState },
      ): Promise<void> => {
        writes[guid] = derived;
      },
      listAllGuids: async (): Promise<string[]> => Object.keys(opts.latestMembers),
    },
    skillsetVersionRepo: {
      findLatestBySkillset: async (guid: string) => {
        const members = opts.latestMembers[guid];
        if (members === undefined || members === null) return null;
        return { members } as never;
      },
      findSkillsetGuidsByMember: async (name: string, guid: string): Promise<string[]> => {
        return opts.byMember?.[name] ?? opts.byMember?.[guid] ?? [];
      },
    },
  } as unknown as SkillsetRecomputeDeps;
  return { deps, writes };
}

describe("recomputeSkillsetVisibility", () => {
  test("writes the derived cache for the latest version", async () => {
    const { deps, writes } = makeDeps({
      refs: { "a@1.0": "public", "b@1.0": "private" },
      latestMembers: { ss: ["a@1.0", "b@1.0"] },
    });
    const result = await recomputeSkillsetVisibility("ss", deps);
    expect(result).toEqual({ membersAllPublic: false, memberVisibilityState: "restricted" });
    expect(writes["ss"]).toEqual({ membersAllPublic: false, memberVisibilityState: "restricted" });
  });

  test("no-op (null, no write) when the skillset has no version", async () => {
    const { deps, writes } = makeDeps({ refs: {}, latestMembers: { ss: null } });
    const result = await recomputeSkillsetVisibility("ss", deps);
    expect(result).toBeNull();
    expect(writes["ss"]).toBeUndefined();
  });
});

describe("recomputeForSkill", () => {
  test("recomputes every skillset referencing the changed skill", async () => {
    const { deps, writes } = makeDeps({
      refs: { "shared@1.0": "private", "pub@1.0": "public" },
      latestMembers: {
        ss1: ["shared@1.0", "pub@1.0"],
        ss2: ["pub@1.0"],
      },
      byMember: { shared: ["ss1", "ss2"], "skl-shared": ["ss1", "ss2"] },
    });
    const affected = await recomputeForSkill("shared", "skl-shared", deps);
    expect(affected.sort()).toEqual(["ss1", "ss2"]);
    expect(writes["ss1"]).toEqual({ membersAllPublic: false, memberVisibilityState: "restricted" });
    // ss2 no longer contains the now-private skill, so it stays all-public.
    expect(writes["ss2"]).toEqual({ membersAllPublic: true, memberVisibilityState: "all-public" });
  });

  test("returns empty + writes nothing when no skillset references the skill", async () => {
    const { deps, writes } = makeDeps({
      refs: {},
      latestMembers: {},
      byMember: {},
    });
    const affected = await recomputeForSkill("orphan", "skl-orphan", deps);
    expect(affected).toEqual([]);
    expect(Object.keys(writes)).toEqual([]);
  });
});

describe("backfillDerivedVisibility", () => {
  test("recomputes the cache for every existing skillset", async () => {
    const { deps, writes } = makeDeps({
      refs: { "pub@1.0": "public", "priv@1.0": "private" },
      latestMembers: {
        all_public: ["pub@1.0"],
        mixed: ["pub@1.0", "priv@1.0"],
        broken: ["pub@1.0", "gone@1.0"],
      },
    });
    await backfillDerivedVisibility(deps);
    expect(writes["all_public"]).toEqual({ membersAllPublic: true, memberVisibilityState: "all-public" });
    expect(writes["mixed"]).toEqual({ membersAllPublic: false, memberVisibilityState: "restricted" });
    expect(writes["broken"]).toEqual({ membersAllPublic: false, memberVisibilityState: "unresolvable" });
  });

  test("a single skillset failure is skipped, not fatal", async () => {
    const { deps, writes } = makeDeps({
      refs: { "pub@1.0": "public" },
      latestMembers: { ok: ["pub@1.0"], boom: ["pub@1.0"] },
    });
    // Force `boom`'s recompute to throw by making its version lookup reject.
    const versionRepo = deps.skillsetVersionRepo as unknown as {
      findLatestBySkillset: (g: string) => Promise<unknown>;
    };
    const original = versionRepo.findLatestBySkillset.bind(versionRepo);
    versionRepo.findLatestBySkillset = async (g: string) => {
      if (g === "boom") throw new Error("simulated repo failure");
      return original(g);
    };
    await backfillDerivedVisibility(deps);
    // `ok` still got recomputed despite `boom` blowing up.
    expect(writes["ok"]).toEqual({ membersAllPublic: true, memberVisibilityState: "all-public" });
    expect(writes["boom"]).toBeUndefined();
  });
});
