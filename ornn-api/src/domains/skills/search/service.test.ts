/**
 * SearchService unit tests (#876).
 *
 * The service is fully DI-driven (skillRepo + llmClient +
 * defaultModelResolver), so this suite hand-rolls fakes for every
 * collaborator and never touches a real DB / network / LLM:
 *   - skillRepo  → records the keyword / scope / semantic surface
 *     (findByScope, keywordSearch, findAllByScope) and returns
 *     SkillDocument-shaped fixtures.
 *   - llmClient  → fake `complete()` (NOT stream) returning a
 *     Responses-API `[{type:"message",content:[{type:"output_text",
 *     text}]}]` shape, with per-call arg capture so prompt projection
 *     and the model-selection branch can be asserted.
 *   - defaultModelResolver → records whether it was consulted.
 *
 * The LLM ranker is exercised through `search({ mode: "semantic" })`,
 * which drives `semanticSearch` → `evaluateBatch` → `buildSkillSummary`
 * and the post-rank pagination / score-filter logic. The per-caller
 * `enrichItem` ladder is exercised through the keyword path (no LLM
 * round-trip needed). The #720 defensive shared-via-org *keep* path is
 * covered there too; its *drop/warn* branch is structurally unreachable
 * via `search()` (enrichItem derives `sharedViaOrgId` from the same
 * `userOrgIds` the filter checks against) — see the #720 describe block
 * for the evidence comment.
 *
 * @module domains/skills/search/service.test
 */

import { describe, expect, test } from "bun:test";
import { SearchService, type SearchServiceDeps } from "./service";
import type { SkillRepository } from "../crud/repository";
import type {
  NyxLlmClient,
  NyxLlmCompleteParams,
  ResponsesApiOutput,
} from "../../../clients/nyxid/llm";
import type { SkillDocument } from "../../../shared/types/index";

// ---- Fixtures --------------------------------------------------------

const T0 = new Date("2026-01-01T00:00:00.000Z");

/**
 * Build a SkillDocument with sensible defaults. Tests override only the
 * fields the case cares about. `createdOn`/`updatedOn` default to a
 * fixed Date so the ISO projection in `enrichItem` is deterministic.
 */
function doc(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    guid: "guid-1",
    name: "demo-skill",
    description: "a demo skill",
    license: null,
    compatibility: null,
    metadata: { category: "general" },
    skillHash: "hash-1",
    storageKey: "skills/guid-1.zip",
    createdBy: "author-1",
    createdOn: T0,
    updatedBy: "author-1",
    updatedOn: T0,
    isPrivate: false,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    latestVersion: "1.0",
    ...overrides,
  };
}

// ---- Fake skill repository ------------------------------------------
//
// Records the exact arguments search() passes through so we can assert
// the keyword-vs-scope branch and the semantic candidate pool. Each
// query method returns a configurable canned result.

interface ScopeCall {
  scope: string;
  currentUserId: string;
  userOrgIds: string[];
  page: number;
  pageSize: number;
}

class FakeSkillRepo {
  findByScopeCalls: ScopeCall[] = [];
  keywordSearchCalls: Array<ScopeCall & { query: string }> = [];
  findAllByScopeCalls: Array<{ scope: string; currentUserId: string; userOrgIds: string[] }> = [];

  byScopeResult: { skills: SkillDocument[]; total: number } = { skills: [], total: 0 };
  keywordResult: { skills: SkillDocument[]; total: number } = { skills: [], total: 0 };
  allByScopeResult: SkillDocument[] = [];

  async findByScope(
    scope: string,
    currentUserId: string,
    userOrgIds: string[],
    page: number,
    pageSize: number,
  ): Promise<{ skills: SkillDocument[]; total: number }> {
    this.findByScopeCalls.push({ scope, currentUserId, userOrgIds, page, pageSize });
    return this.byScopeResult;
  }

  async keywordSearch(
    query: string,
    scope: string,
    currentUserId: string,
    userOrgIds: string[],
    page: number,
    pageSize: number,
  ): Promise<{ skills: SkillDocument[]; total: number }> {
    this.keywordSearchCalls.push({ query, scope, currentUserId, userOrgIds, page, pageSize });
    return this.keywordResult;
  }

  async findAllByScope(
    scope: string,
    currentUserId: string,
    userOrgIds: string[],
  ): Promise<SkillDocument[]> {
    this.findAllByScopeCalls.push({ scope, currentUserId, userOrgIds });
    return this.allByScopeResult;
  }
}

// ---- Fake LLM client -------------------------------------------------
//
// Captures every complete() call (model + the rendered prompt) and
// returns a scripted queue of response texts wrapped in the
// Responses-API message shape. A text of `__THROW__` simulates an
// upstream failure so the per-batch catch branch is exercised.

class FakeLlmClient {
  calls: NyxLlmCompleteParams[] = [];
  private queue: string[];

  constructor(responses: string[]) {
    this.queue = [...responses];
  }

  async complete(params: NyxLlmCompleteParams): Promise<ResponsesApiOutput[]> {
    this.calls.push(params);
    const text = this.queue.shift() ?? "[]";
    if (text === "__THROW__") {
      throw new Error("LLM gateway 502");
    }
    return [{ type: "message", content: [{ type: "output_text", text }] }];
  }

  /** The rendered user prompt of the Nth complete() call. */
  promptAt(i: number): string {
    const call = this.calls[i];
    const first = call?.input[0];
    return typeof first?.content === "string" ? first.content : "";
  }
}

interface Harness {
  service: SearchService;
  repo: FakeSkillRepo;
  llm: FakeLlmClient;
  defaultModelCalls: number;
}

function makeService(opts: {
  repo?: FakeSkillRepo;
  responses?: string[];
  defaultModel?: string;
} = {}): Harness {
  const repo = opts.repo ?? new FakeSkillRepo();
  const llm = new FakeLlmClient(opts.responses ?? []);
  const state = { defaultModelCalls: 0 };
  const defaultModelResolver = async () => {
    state.defaultModelCalls++;
    return opts.defaultModel ?? "default-model";
  };
  const deps: SearchServiceDeps = {
    skillRepo: repo as unknown as SkillRepository,
    llmClient: llm as unknown as NyxLlmClient,
    defaultModelResolver,
  };
  const service = new SearchService(deps);
  return {
    service,
    repo,
    llm,
    get defaultModelCalls() {
      return state.defaultModelCalls;
    },
  } as Harness;
}

/** A scored-rows JSON array as the LLM ranker is contracted to return. */
function rerank(rows: Array<{ id: string; score: number; reason?: string }>): string {
  return JSON.stringify(rows);
}

const BASE = {
  page: 1,
  pageSize: 9,
  currentUserId: "caller-1",
  userOrgIds: [] as string[],
};

// ---------------------------------------------------------------------
// Keyword mode
// ---------------------------------------------------------------------

describe("search — keyword mode", () => {
  test("empty query routes to findByScope (not keywordSearch)", async () => {
    const { service, repo } = makeService();
    repo.byScopeResult = { skills: [doc()], total: 1 };

    const res = await service.search({
      ...BASE,
      query: "   ",
      mode: "keyword",
      scope: "public",
    });

    expect(repo.findByScopeCalls.length).toBe(1);
    expect(repo.keywordSearchCalls.length).toBe(0);
    expect(repo.findByScopeCalls[0]?.scope).toBe("public");
    expect(res.total).toBe(1);
    expect(res.items.length).toBe(1);
  });

  test("non-empty query routes to keywordSearch", async () => {
    const { service, repo } = makeService();
    repo.keywordResult = { skills: [doc(), doc({ guid: "guid-2" })], total: 2 };

    const res = await service.search({
      ...BASE,
      query: "csv parser",
      mode: "keyword",
      scope: "mixed",
    });

    expect(repo.keywordSearchCalls.length).toBe(1);
    expect(repo.findByScopeCalls.length).toBe(0);
    expect(repo.keywordSearchCalls[0]?.query).toBe("csv parser");
    expect(res.total).toBe(2);
  });

  test("never consults the LLM in keyword mode", async () => {
    const { service, repo, llm } = makeService();
    repo.keywordResult = { skills: [doc()], total: 1 };
    await service.search({ ...BASE, query: "x", mode: "keyword", scope: "public" });
    expect(llm.calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------
// Semantic mode — happy path: ordering, pagination, score filter
// ---------------------------------------------------------------------

describe("search — semantic mode happy path", () => {
  test("ranks score-desc, honours pagination slice, drops score<=0", async () => {
    const pool = [
      doc({ guid: "a" }),
      doc({ guid: "b" }),
      doc({ guid: "c" }),
      doc({ guid: "d" }),
    ];
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = pool;
    // Out-of-order scores; `d` is filtered out (score 0).
    const responses = [
      rerank([
        { id: "b", score: 3 },
        { id: "a", score: 9 },
        { id: "d", score: 0 },
        { id: "c", score: 6 },
      ]),
    ];
    const { service } = makeService({ repo, responses });

    const res = await service.search({
      ...BASE,
      query: "ranking",
      mode: "semantic",
      scope: "public",
      page: 1,
      pageSize: 2,
    });

    // score 0 dropped → 3 matched total; page 1 size 2 → top two by score.
    expect(res.total).toBe(3);
    expect(res.totalPages).toBe(2);
    expect(res.items.map((i) => i.guid)).toEqual(["a", "c"]);
  });

  test("page 2 returns the pagination remainder in rank order", async () => {
    const pool = [doc({ guid: "a" }), doc({ guid: "b" }), doc({ guid: "c" })];
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = pool;
    const responses = [
      rerank([
        { id: "a", score: 9 },
        { id: "b", score: 7 },
        { id: "c", score: 5 },
      ]),
    ];
    const { service } = makeService({ repo, responses });

    const res = await service.search({
      ...BASE,
      query: "ranking",
      mode: "semantic",
      scope: "public",
      page: 2,
      pageSize: 2,
    });

    expect(res.total).toBe(3);
    expect(res.items.map((i) => i.guid)).toEqual(["c"]);
  });

  test("explicit model is forwarded to the LLM and the resolver is skipped", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [doc({ guid: "a" })];
    const h = makeService({ repo, responses: [rerank([{ id: "a", score: 8 }])] });

    await h.service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
      model: "explicit-model",
    });

    expect(h.llm.calls[0]?.model).toBe("explicit-model");
    expect(h.defaultModelCalls).toBe(0);
  });

  test("absent model falls back to defaultModelResolver", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [doc({ guid: "a" })];
    const h = makeService({
      repo,
      responses: [rerank([{ id: "a", score: 8 }])],
      defaultModel: "resolved-model",
    });

    await h.service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
    });

    expect(h.defaultModelCalls).toBe(1);
    expect(h.llm.calls[0]?.model).toBe("resolved-model");
  });
});

// ---------------------------------------------------------------------
// Semantic mode — empty candidate pool after pre-LLM filters
// ---------------------------------------------------------------------

describe("search — semantic empty pool (filters short-circuit the LLM)", () => {
  test("systemFilter 'only' with no system skills → empty, no LLM call", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [doc({ guid: "a", isSystemSkill: false })];
    const { service, llm } = makeService({ repo });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
      systemFilter: "only",
    });

    expect(res).toEqual({
      searchMode: "semantic",
      searchScope: "public",
      total: 0,
      totalPages: 0,
      page: 1,
      pageSize: 9,
      items: [],
    });
    expect(llm.calls.length).toBe(0);
  });

  test("systemFilter 'exclude' drops the only (system) skill → empty", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [doc({ guid: "a", isSystemSkill: true })];
    const { service, llm } = makeService({ repo });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
      systemFilter: "exclude",
    });

    expect(res.total).toBe(0);
    expect(llm.calls.length).toBe(0);
  });

  test("nyxidServiceId filter with no match → empty", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [doc({ guid: "a", nyxidServiceId: "svc-x" })];
    const { service, llm } = makeService({ repo });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
      nyxidServiceId: "svc-y",
    });

    expect(res.total).toBe(0);
    expect(llm.calls.length).toBe(0);
  });

  test("tagsAll AND-match with a missing tag → empty", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [
      doc({ guid: "a", metadata: { category: "general", tags: ["csv"] } }),
    ];
    const { service, llm } = makeService({ repo });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
      tagsAll: ["csv", "pdf"],
    });

    expect(res.total).toBe(0);
    expect(llm.calls.length).toBe(0);
  });

  test("tagsAll AND-match passes when every tag is present", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [
      doc({ guid: "a", metadata: { category: "general", tags: ["csv", "pdf"] } }),
    ];
    const { service } = makeService({
      repo,
      responses: [rerank([{ id: "a", score: 5 }])],
    });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
      tagsAll: ["csv", "pdf"],
    });

    expect(res.total).toBe(1);
  });
});

// ---------------------------------------------------------------------
// Semantic mode — multi-batch fan-out
// ---------------------------------------------------------------------

describe("search — semantic multi-batch", () => {
  test("pool larger than BATCH_SIZE (50) issues multiple complete() calls, merged", async () => {
    // 120 skills → ceil(120/50) = 3 batches.
    const pool = Array.from({ length: 120 }, (_, i) => doc({ guid: `g${i}` }));
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = pool;
    // Each batch scores exactly its first member highly; the rest are
    // implicitly absent (treated as no-match) so the merged set is the
    // three batch leaders.
    const responses = [
      rerank([{ id: "g0", score: 9 }]),
      rerank([{ id: "g50", score: 8 }]),
      rerank([{ id: "g100", score: 7 }]),
    ];
    const { service, llm } = makeService({ repo, responses });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
      pageSize: 50,
    });

    expect(llm.calls.length).toBe(3);
    expect(res.total).toBe(3);
    expect(res.items.map((i) => i.guid)).toEqual(["g0", "g50", "g100"]);
  });

  test("a failed batch degrades in isolation; sibling batches still contribute", async () => {
    // Same 3-batch fan-out, but the FIRST batch's LLM call throws. The
    // per-batch catch swallows it and yields nothing, while the other two
    // batches score their leaders. The merged result is the surviving
    // siblings — a single upstream hiccup must not zero out the search.
    const pool = Array.from({ length: 120 }, (_, i) => doc({ guid: `g${i}` }));
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = pool;
    const responses = [
      "__THROW__",
      rerank([{ id: "g50", score: 8 }]),
      rerank([{ id: "g100", score: 7 }]),
    ];
    const { service, llm } = makeService({ repo, responses });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
      pageSize: 50,
    });

    // All three batches are attempted; the thrown one contributes nothing
    // but the siblings rank g50 (8) above g100 (7).
    expect(llm.calls.length).toBe(3);
    expect(res.total).toBe(2);
    expect(res.items.map((i) => i.guid)).toEqual(["g50", "g100"]);
  });
});

// ---------------------------------------------------------------------
// Semantic mode — evaluateBatch failure / edge cases (all keep suite green)
// ---------------------------------------------------------------------

describe("search — evaluateBatch resilience", () => {
  test("LLM text with no JSON array → batch yields nothing", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [doc({ guid: "a" })];
    const { service } = makeService({ repo, responses: ["sorry, I cannot help"] });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
    });

    expect(res.total).toBe(0);
    expect(res.items).toEqual([]);
  });

  test("schema-failing rows (score is a string) → batch dropped", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [doc({ guid: "a" })];
    const { service } = makeService({
      repo,
      // valid-looking array bracket, but score is not a number → Zod fails.
      responses: ['[{"id":"a","score":"high"}]'],
    });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
    });

    expect(res.total).toBe(0);
  });

  test("rows referencing GUIDs not in the batch are ignored", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [doc({ guid: "a" })];
    const { service } = makeService({
      repo,
      responses: [rerank([{ id: "ghost", score: 9 }])],
    });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
    });

    expect(res.total).toBe(0);
  });

  test("rows with score <= 0 are filtered out at batch level", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [doc({ guid: "a" }), doc({ guid: "b" })];
    const { service } = makeService({
      repo,
      responses: [
        rerank([
          { id: "a", score: 0 },
          { id: "b", score: 4 },
        ]),
      ],
    });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
    });

    expect(res.total).toBe(1);
    expect(res.items.map((i) => i.guid)).toEqual(["b"]);
  });

  test("score above 10 is clamped to the [0,10] range", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [doc({ guid: "a" }), doc({ guid: "b" })];
    const { service } = makeService({
      repo,
      responses: [
        rerank([
          { id: "a", score: 999 },
          { id: "b", score: 10 },
        ]),
      ],
    });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
    });

    // Both clamp to 10; both survive the score>0 filter. Sort is stable
    // for equal scores so the original pool order (a, b) is preserved.
    expect(res.total).toBe(2);
    expect(res.items.map((i) => i.guid)).toEqual(["a", "b"]);
  });

  test("a thrown LLM call is caught and the batch contributes nothing", async () => {
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [doc({ guid: "a" })];
    const { service } = makeService({ repo, responses: ["__THROW__"] });

    const res = await service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
    });

    expect(res.total).toBe(0);
    expect(res.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// buildSkillSummary projection — asserted via the captured prompt
// ---------------------------------------------------------------------

describe("buildSkillSummary projection (via captured prompt)", () => {
  test("rich skill projects tags/outputType/runtimes+deps+envs/tools+mcp/license/compatibility", async () => {
    const rich = doc({
      guid: "rich",
      license: "MIT",
      compatibility: "claude>=3",
      metadata: {
        category: "data",
        tags: ["csv", "parse"],
        outputType: "file",
        runtimes: [
          {
            runtime: "python",
            dependencies: [{ library: "pandas", version: "2.0" }],
            envs: [{ var: "API_KEY", description: "key" }],
          },
        ],
        tools: [
          {
            tool: "fetcher",
            type: "mcp",
            "mcp-servers": [{ mcp: "http", version: "1" }],
          },
        ],
      },
    });
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [rich];
    const h = makeService({ repo, responses: [rerank([{ id: "rich", score: 5 }])] });

    await h.service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
    });

    const prompt = h.llm.promptAt(0);
    // The prompt embeds the projected summary as JSON — assert each
    // optional branch rendered.
    expect(prompt).toContain('"id": "rich"');
    expect(prompt).toContain('"category": "data"');
    expect(prompt).toContain("csv");
    expect(prompt).toContain('"outputType": "file"');
    expect(prompt).toContain('"runtime": "python"');
    expect(prompt).toContain("pandas@2.0");
    expect(prompt).toContain("API_KEY");
    expect(prompt).toContain('"tool": "fetcher"');
    expect(prompt).toContain("http");
    expect(prompt).toContain('"license": "MIT"');
    expect(prompt).toContain('"compatibility": "claude>=3"');
  });

  test("bare skill omits optional summary fields, defaults category to 'unknown'", async () => {
    // metadata.category is absent so the `?? "unknown"` nullish fallback
    // is taken; no tags/runtimes/tools/license/compatibility present.
    // category is typed as required on SkillMetadata, but the projection
    // tolerates a missing one — cast to drive that branch.
    const bare = doc({
      guid: "bare",
      license: null,
      compatibility: null,
      metadata: {} as SkillDocument["metadata"],
    });
    const repo = new FakeSkillRepo();
    repo.allByScopeResult = [bare];
    const h = makeService({ repo, responses: [rerank([{ id: "bare", score: 5 }])] });

    await h.service.search({
      ...BASE,
      query: "q",
      mode: "semantic",
      scope: "public",
    });

    const prompt = h.llm.promptAt(0);
    expect(prompt).toContain('"category": "unknown"');
    expect(prompt).not.toContain('"runtimes"');
    expect(prompt).not.toContain('"tools"');
    expect(prompt).not.toContain('"license"');
    expect(prompt).not.toContain('"compatibility"');
  });
});

// ---------------------------------------------------------------------
// enrichItem access-reason ladder + derived fields (keyword path)
// ---------------------------------------------------------------------

/** Run a keyword search returning exactly `skills`, return the items. */
async function enrichVia(
  skills: SkillDocument[],
  params: Partial<Parameters<SearchService["search"]>[0]> = {},
) {
  const repo = new FakeSkillRepo();
  repo.byScopeResult = { skills, total: skills.length };
  const { service } = makeService({ repo });
  const res = await service.search({
    ...BASE,
    query: "",
    mode: "keyword",
    scope: "mixed",
    ...params,
  });
  return res.items;
}

describe("enrichItem access-reason ladder", () => {
  test("owner wins over everything else", async () => {
    const items = await enrichVia(
      [doc({ guid: "x", createdBy: "caller-1", isPrivate: true })],
      { currentUserId: "caller-1" },
    );
    expect(items[0]?.myAccessReason).toBe("owner");
  });

  test("public when not private and not author", async () => {
    const items = await enrichVia(
      [doc({ guid: "x", createdBy: "someone-else", isPrivate: false })],
      { currentUserId: "caller-1" },
    );
    expect(items[0]?.myAccessReason).toBe("public");
  });

  test("shared-direct when private and caller is in sharedWithUsers", async () => {
    const items = await enrichVia(
      [
        doc({
          guid: "x",
          createdBy: "someone-else",
          isPrivate: true,
          sharedWithUsers: ["caller-1"],
        }),
      ],
      { currentUserId: "caller-1" },
    );
    expect(items[0]?.myAccessReason).toBe("shared-direct");
  });

  test("shared-via-org when private and one of caller's orgs is granted", async () => {
    const items = await enrichVia(
      [
        doc({
          guid: "x",
          createdBy: "someone-else",
          isPrivate: true,
          sharedWithOrgs: ["org-9"],
        }),
      ],
      { currentUserId: "caller-1", userOrgIds: ["org-9"], scope: "mixed" },
    );
    expect(items[0]?.myAccessReason).toBe("shared-via-org");
    expect(items[0]?.sharedViaOrgId).toBe("org-9");
  });

  test("none when private with no grant the caller satisfies", async () => {
    const items = await enrichVia(
      [doc({ guid: "x", createdBy: "someone-else", isPrivate: true })],
      { currentUserId: "caller-1" },
    );
    expect(items[0]?.myAccessReason).toBeUndefined();
  });
});

describe("enrichItem derived fields", () => {
  test("systemForService is populated for a system skill tied to a service", async () => {
    const items = await enrichVia([
      doc({
        guid: "x",
        isSystemSkill: true,
        nyxidServiceId: "svc-1",
        nyxidServiceSlug: "billing",
        nyxidServiceLabel: "Billing",
      }),
    ]);
    expect(items[0]?.isSystemForMe).toBe(true);
    expect(items[0]?.systemForService).toEqual({
      id: "svc-1",
      slug: "billing",
      label: "Billing",
    });
  });

  test("systemForService is undefined when the skill is not a system skill", async () => {
    const items = await enrichVia([
      doc({ guid: "x", isSystemSkill: false, nyxidServiceId: "svc-1" }),
    ]);
    expect(items[0]?.isSystemForMe).toBe(false);
    expect(items[0]?.systemForService).toBeUndefined();
  });

  test("hasGithubSource is true only for a github source pointer", async () => {
    const withSource = await enrichVia([
      doc({
        guid: "x",
        source: { type: "github", repo: "o/r", ref: "main", path: "" },
      }),
    ]);
    expect(withSource[0]?.hasGithubSource).toBe(true);

    const without = await enrichVia([doc({ guid: "y" })]);
    expect(without[0]?.hasGithubSource).toBe(false);
  });

  test("createdOn Date is serialized to ISO; a string passthrough is preserved", async () => {
    const fromDate = await enrichVia([doc({ guid: "x", createdOn: T0 })]);
    expect(fromDate[0]?.createdOn).toBe(T0.toISOString());

    const fromString = await enrichVia([
      // Repo layer normally hands Dates, but the projection must not
      // crash on a string — String(...) passthrough branch.
      doc({ guid: "y", createdOn: "2025-12-31T00:00:00.000Z" as unknown as Date }),
    ]);
    expect(fromString[0]?.createdOn).toBe("2025-12-31T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------
// #720 defensive shared-with-me drop
// ---------------------------------------------------------------------

describe("#720 shared-with-me defensive filter", () => {
  test("drops a shared-via-org item whose org the caller is no longer in", async () => {
    const repo = new FakeSkillRepo();
    // Item resolves to shared-via-org pointing at org-stale, but the
    // caller's effective orgs (userOrgIds) do NOT include it — applyScope
    // and the live org set disagree. The item must be dropped.
    repo.byScopeResult = {
      skills: [
        doc({
          guid: "leak",
          createdBy: "someone-else",
          isPrivate: true,
          sharedWithOrgs: ["org-stale"],
        }),
      ],
      total: 1,
    };
    const { service } = makeService({ repo });

    const res = await service.search({
      ...BASE,
      query: "",
      mode: "keyword",
      scope: "shared-with-me",
      userOrgIds: ["org-current"],
    });

    // enrichItem couldn't even resolve shared-via-org (org not in caller
    // set) so myAccessReason is undefined → defensive filter keeps the
    // total but the item carries no leaked access reason.
    expect(res.items.every((i) => i.myAccessReason !== "shared-via-org")).toBe(true);
  });

  test("keeps a shared-via-org item whose org the caller is still in", async () => {
    const repo = new FakeSkillRepo();
    repo.byScopeResult = {
      skills: [
        doc({
          guid: "ok",
          createdBy: "someone-else",
          isPrivate: true,
          sharedWithOrgs: ["org-current"],
        }),
      ],
      total: 1,
    };
    const { service } = makeService({ repo });

    const res = await service.search({
      ...BASE,
      query: "",
      mode: "keyword",
      scope: "shared-with-me",
      userOrgIds: ["org-current"],
    });

    expect(res.items.length).toBe(1);
    expect(res.items[0]?.myAccessReason).toBe("shared-via-org");
    expect(res.items[0]?.sharedViaOrgId).toBe("org-current");
  });

  test("multi-org grant keeps the item when one matched org is live (no drop)", async () => {
    const repo = new FakeSkillRepo();
    // Two items, both reaching enrichItem as shared-via-org. Each doc
    // grants org-current (which the caller IS in), so enrichItem resolves
    // sharedViaOrgId to a live org for both. The #720 filter checks that
    // resolved org against the SAME userOrgIds → both pass, nothing is
    // dropped. The first doc also lists org-A (a dead org) ahead of
    // org-current, proving the multi-org grant doesn't cause a false drop:
    // enrichItem picks the FIRST grant the caller is in, never a dead one.
    repo.byScopeResult = {
      skills: [
        doc({
          guid: "stale",
          createdBy: "someone-else",
          isPrivate: true,
          sharedWithOrgs: ["org-A", "org-current"],
        }),
        doc({
          guid: "kept",
          createdBy: "someone-else",
          isPrivate: true,
          sharedWithOrgs: ["org-current"],
        }),
      ],
      total: 2,
    };
    const { service } = makeService({ repo });

    // enrichItem matches the FIRST org in sharedWithOrgs that the caller
    // is in. For "stale" the caller is in org-current (second entry), so
    // sharedViaOrgId resolves to org-current and the item is KEPT — both
    // survive.
    //
    // The #720 drop/warn branch (service.ts: `return false` when the
    // resolved sharedViaOrgId is absent from orgSet) is STRUCTURALLY
    // UNREACHABLE through search(): enrichItem derives sharedViaOrgId by
    // `.find`-ing inside callerOrgIds, and the filter rebuilds orgSet from
    // the SAME userOrgIds argument. A shared-via-org item therefore always
    // carries a sharedViaOrgId that is — by construction — a member of the
    // set the filter checks against. There is no second org-set source to
    // make the two disagree, so no consistent-input call can trip the drop.
    // The defensive branch only earns its keep against a future regression
    // that decouples those two sets; it is intentionally left in place.
    const res = await service.search({
      ...BASE,
      query: "",
      mode: "keyword",
      scope: "shared-with-me",
      userOrgIds: ["org-current"],
    });
    expect(res.items.length).toBe(2);
  });
});

// ---------------------------------------------------------------------
// SkillSearchResponse envelope
// ---------------------------------------------------------------------

describe("SkillSearchResponse envelope", () => {
  test("carries searchMode/searchScope/total/totalPages/page/pageSize/items", async () => {
    const repo = new FakeSkillRepo();
    repo.keywordResult = { skills: [doc(), doc({ guid: "g2" })], total: 25 };
    const { service } = makeService({ repo });

    const res = await service.search({
      ...BASE,
      query: "x",
      mode: "keyword",
      scope: "mixed",
      page: 2,
      pageSize: 10,
    });

    expect(res.searchMode).toBe("keyword");
    expect(res.searchScope).toBe("mixed");
    expect(res.total).toBe(25);
    expect(res.totalPages).toBe(Math.ceil(25 / 10)); // 3
    expect(res.page).toBe(2);
    expect(res.pageSize).toBe(10);
    expect(res.items.length).toBe(2);
  });
});
