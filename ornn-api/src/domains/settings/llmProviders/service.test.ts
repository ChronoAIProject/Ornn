/**
 * UT-LLM-001..013 — LlmProvidersService unit tests against an in-memory
 * repository fake.
 *
 * @module domains/settings/llmProviders/service.test
 */

import { describe, expect, it } from "bun:test";
import { isMidMaskSentinel, midMaskSecret } from "../../../infra/crypto";
import { LlmProvidersService, type ModelListFetcher } from "./service";
import type { StoredProvider } from "./repository";

const KEY = "ornn-test-passphrase-32-chars-min-okOK";
const ACTOR = { userId: "u-admin", email: "admin@test.local", displayName: "Admin" };

class FakeRepo {
  rows = new Map<string, StoredProvider>();
  async ensureIndexes() {}
  async list(): Promise<ReadonlyArray<StoredProvider>> {
    return [...this.rows.values()];
  }
  async findById(id: string): Promise<StoredProvider | null> {
    return this.rows.get(id) ?? null;
  }
  async findByName(name: string): Promise<StoredProvider | null> {
    for (const r of this.rows.values()) {
      if (r.name === name) return r;
    }
    return null;
  }
  async insert(doc: StoredProvider): Promise<void> {
    this.rows.set(doc._id, doc);
  }
  async replace(id: string, doc: StoredProvider): Promise<void> {
    this.rows.set(id, doc);
  }
  async deleteById(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }
  async clearDefaultsForSurfaceExcept(
    surface: "Playground" | "SkillGen",
    keep: { providerId: string; modelId: string } | null,
  ): Promise<void> {
    const defKey =
      surface === "Playground" ? "defaultForPlayground" : "defaultForSkillGen";
    for (const [id, doc] of this.rows) {
      const isKeeper = keep && id === keep.providerId;
      const nextModels = doc.models.map((m) => {
        if (isKeeper && m.id === keep!.modelId) return m;
        if ((m as unknown as Record<string, unknown>)[defKey] !== true) return m;
        return { ...m, [defKey]: false };
      });
      this.rows.set(id, { ...doc, models: nextModels });
    }
  }
}

class StubFetcher implements ModelListFetcher {
  next: ReadonlyArray<{ id: string; displayName: string }> = [];
  calls = 0;
  async fetch(): Promise<ReadonlyArray<{ id: string; displayName: string }>> {
    this.calls += 1;
    return this.next;
  }
}

function makeService() {
  const repo = new FakeRepo();
  const fetcher = new StubFetcher();
  const svc = new LlmProvidersService({
    repo: repo as unknown as import("./repository").LlmProvidersRepository,
    encryptionKey: KEY,
    modelListFetcher: fetcher,
  });
  return { svc, repo, fetcher };
}

const baseInput = {
  name: "openai",
  gatewayUrl: "https://api.openai.com",
  modelListUrl: "https://api.openai.com/v1/models",
  apiFormat: "chat-completion" as const,
  maxOutputTokens: 8192,
  defaultTemperature: 0.7,
  models: [
    {
      id: "gpt-4o",
      displayName: "GPT-4o",
      enabledForPlayground: true,
      enabledForSkillGen: true,
      defaultForPlayground: true,
      defaultForSkillGen: true,
    },
    {
      id: "gpt-3.5",
      displayName: "GPT-3.5",
      enabledForPlayground: false,
      enabledForSkillGen: false,
    },
  ],
};

describe("LlmProvidersService", () => {
  it("UT-LLM-001: apiKey auth — DB has ciphertext, GET mid-masks", async () => {
    const { svc, repo } = makeService();
    const created = await svc.create(
      { ...baseInput, auth: { kind: "apiKey", apiKey: "sk-real-key-1234" } },
      ACTOR,
    );
    const stored = await repo.findById(created._id);
    expect(stored?.auth.kind).toBe("apiKey");
    expect((stored?.auth as { apiKeyEnc: string }).apiKeyEnc).toMatch(/^v1:/);
    const masked = await svc.getForAdmin(created._id);
    if (masked?.auth.kind !== "apiKey") throw new Error("kind");
    expect(isMidMaskSentinel(masked.auth.apiKey)).toBe(true);
  });

  it("UT-LLM-002: tokenUrl auth — clientSecret encrypted + masked", async () => {
    const { svc } = makeService();
    const created = await svc.create(
      {
        ...baseInput,
        name: "tokenized",
        auth: {
          kind: "tokenUrl",
          tokenUrl: "https://idp.example.com/token",
          clientId: "client-x",
          clientSecret: "shh-secret-123456",
        },
      },
      ACTOR,
    );
    const masked = await svc.getForAdmin(created._id);
    if (masked?.auth.kind !== "tokenUrl") throw new Error("kind");
    expect(isMidMaskSentinel(masked.auth.clientSecret)).toBe(true);
    expect(masked.auth.clientId).toBe("client-x");
  });

  it("UT-LLM-003: basic auth — password encrypted + masked", async () => {
    const { svc } = makeService();
    const created = await svc.create(
      {
        ...baseInput,
        name: "basicauthsvc",
        auth: { kind: "basic", username: "u", password: "p4ssword!23456" },
      },
      ACTOR,
    );
    const masked = await svc.getForAdmin(created._id);
    if (masked?.auth.kind !== "basic") throw new Error("kind");
    expect(isMidMaskSentinel(masked.auth.password)).toBe(true);
    expect(masked.auth.username).toBe("u");
  });

  it("UT-LLM-004: update preserves model surface flags", async () => {
    const { svc } = makeService();
    const created = await svc.create(
      { ...baseInput, auth: { kind: "apiKey", apiKey: "sk-aaaaaa" } },
      ACTOR,
    );
    const updated = await svc.update(
      created._id,
      {
        models: [
          {
            id: "gpt-4o",
            displayName: "GPT-4o (renamed)",
            enabledForPlayground: true,
            enabledForSkillGen: true,
          },
          { id: "gpt-3.5", displayName: "GPT-3.5" },
        ],
      },
      ACTOR,
    );
    const m = updated.models.find((x) => x.id === "gpt-4o")!;
    expect(m.enabledForPlayground).toBe(true);
    expect(m.enabledForSkillGen).toBe(true);
    expect(m.displayName).toBe("GPT-4o (renamed)");
  });

  it("UT-LLM-004a: update WITHOUT models key preserves existing list (#588)", async () => {
    // The ProviderEditDrawer's basic-settings save sends only name /
    // gatewayUrl / etc. — no `models` field. Before #588 the update
    // schema's inherited `.default([])` parsed the missing field as
    // `[]`, then `if (patch.models)` was truthy on `[]` and silently
    // wiped the model list. This pins the "undefined means preserve"
    // contract so a future schema refactor can't regress.
    const { svc } = makeService();
    const created = await svc.create(
      { ...baseInput, auth: { kind: "apiKey", apiKey: "sk-aaaaaa" } },
      ACTOR,
    );
    expect(created.models.length).toBeGreaterThan(0);
    const updated = await svc.update(
      created._id,
      {
        // basic-settings-only patch — no `models` field whatsoever
        name: "renamed-provider",
        maxOutputTokens: 4096,
      },
      ACTOR,
    );
    expect(updated.name).toBe("renamed-provider");
    expect(updated.maxOutputTokens).toBe(4096);
    expect(updated.models.length).toBe(created.models.length);
    expect(updated.models.map((m) => m.id).sort()).toEqual(
      created.models.map((m) => m.id).sort(),
    );
  });

  it("UT-LLM-004b: update WITH explicit models: [] wipes the list (#588)", async () => {
    // Symmetry check: passing an explicit empty array IS a valid
    // "remove everything" intent (e.g. the model-list refresh found
    // zero models on the upstream provider). The fix must preserve
    // that path while only treating `undefined` as "don't touch".
    const { svc } = makeService();
    const created = await svc.create(
      { ...baseInput, auth: { kind: "apiKey", apiKey: "sk-aaaaaa" } },
      ACTOR,
    );
    expect(created.models.length).toBeGreaterThan(0);
    const updated = await svc.update(
      created._id,
      { models: [] },
      ACTOR,
    );
    expect(updated.models).toEqual([]);
  });

  it("UT-LLM-004c: listPickerModels honours sectionDefaultModelId override (#607)", async () => {
    // Admin pins playground.defaultModelId = "gpt-3.5" via settings.
    // Without the override the picker would return whichever model
    // has `defaultForPlayground: true`. With the override the pinned
    // model wins the `default` slot and lands first in the items list,
    // matching what `resolveSurfaceDefaults` does on the execute path.
    const { svc } = makeService();
    await svc.create(
      {
        ...baseInput,
        name: "alpha",
        auth: { kind: "apiKey", apiKey: "k1" },
        models: [
          {
            id: "gpt-4o",
            displayName: "GPT-4o",
            enabledForPlayground: true,
            defaultForPlayground: true,
          },
          {
            id: "gpt-3.5",
            displayName: "GPT-3.5",
            enabledForPlayground: true,
          },
        ],
      },
      ACTOR,
    );

    // No override → per-model flag wins, gpt-4o is default.
    const noOverride = await svc.listPickerModels("playground");
    expect(noOverride.default).toBe("gpt-4o");
    expect(noOverride.items[0]?.modelId).toBe("gpt-4o");

    // With section pin → gpt-3.5 wins.
    const pinned = await svc.listPickerModels("playground", "gpt-3.5");
    expect(pinned.default).toBe("gpt-3.5");
    expect(pinned.items[0]?.modelId).toBe("gpt-3.5");
    expect(pinned.items[0]?.isDefault).toBe(true);
    // gpt-4o is still in the list, just no longer marked default.
    const gpt4o = pinned.items.find((i) => i.modelId === "gpt-4o");
    expect(gpt4o?.isDefault).toBe(false);

    // Pin points at a disabled/missing model → falls through to the
    // first enabled item; nothing is marked default.
    const stalePin = await svc.listPickerModels("playground", "gpt-deprecated");
    expect(stalePin.items.every((i) => i.isDefault === false)).toBe(true);
    expect(stalePin.default).toBe(stalePin.items[0]?.modelId ?? null);
  });

  it("UT-LLM-005: sync — newly arrived model lands with all surface flags false", async () => {
    const { svc, fetcher } = makeService();
    const created = await svc.create(
      { ...baseInput, auth: { kind: "apiKey", apiKey: "k" } },
      ACTOR,
    );
    fetcher.next = [
      { id: "gpt-4o", displayName: "GPT-4o" },
      { id: "gpt-3.5", displayName: "GPT-3.5" },
      { id: "gpt-5", displayName: "GPT-5" },
    ];
    const { provider, result } = await svc.sync(created._id, ACTOR);
    expect(result.added).toBe(1);
    const newModel = provider.models.find((m) => m.id === "gpt-5")!;
    expect(newModel.enabledForPlayground).toBe(false);
    expect(newModel.enabledForSkillGen).toBe(false);
    expect(newModel.defaultForPlayground).toBe(false);
    expect(newModel.defaultForSkillGen).toBe(false);
    expect(newModel.removed).toBe(false);
  });

  it("UT-LLM-006: sync — removed model marked + kept", async () => {
    const { svc, fetcher } = makeService();
    const created = await svc.create(
      { ...baseInput, auth: { kind: "apiKey", apiKey: "k" } },
      ACTOR,
    );
    fetcher.next = [{ id: "gpt-4o", displayName: "GPT-4o" }];
    const { provider, result } = await svc.sync(created._id, ACTOR);
    expect(result.removed).toBe(1);
    const dropped = provider.models.find((m) => m.id === "gpt-3.5")!;
    expect(dropped).toBeDefined();
    expect(dropped.removed).toBe(true);
  });

  it("UT-LLM-007: sync idempotent — second run zero changes", async () => {
    const { svc, fetcher } = makeService();
    const created = await svc.create(
      { ...baseInput, auth: { kind: "apiKey", apiKey: "k" } },
      ACTOR,
    );
    fetcher.next = [
      { id: "gpt-4o", displayName: "GPT-4o" },
      { id: "gpt-3.5", displayName: "GPT-3.5" },
    ];
    await svc.sync(created._id, ACTOR);
    const { result } = await svc.sync(created._id, ACTOR);
    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it("UT-LLM-008: patchModel — setting defaultForX implies enabledForX (#270)", async () => {
    const { svc } = makeService();
    const created = await svc.create(
      { ...baseInput, auth: { kind: "apiKey", apiKey: "k" } },
      ACTOR,
    );
    // gpt-3.5 starts with enabledForPlayground: false. Setting it as
    // the default must auto-enable it for that surface.
    const after = await svc.patchModel(
      created._id,
      "gpt-3.5",
      { defaultForPlayground: true },
      ACTOR,
    );
    const gpt35 = after.models.find((m) => m.id === "gpt-3.5")!;
    expect(gpt35.defaultForPlayground).toBe(true);
    expect(gpt35.enabledForPlayground).toBe(true);
  });

  it("UT-LLM-009: patchModel — setting defaultForX clears it on every other model (#270)", async () => {
    const { svc } = makeService();
    const created = await svc.create(
      { ...baseInput, auth: { kind: "apiKey", apiKey: "k" } },
      ACTOR,
    );
    // baseInput marks gpt-4o as defaultForPlayground; flipping the
    // default to gpt-3.5 must clear gpt-4o's default flag in the same
    // write so the at-most-one invariant holds.
    const after = await svc.patchModel(
      created._id,
      "gpt-3.5",
      { defaultForPlayground: true },
      ACTOR,
    );
    const gpt4o = after.models.find((m) => m.id === "gpt-4o")!;
    expect(gpt4o.defaultForPlayground).toBe(false);
    const gpt35 = after.models.find((m) => m.id === "gpt-3.5")!;
    expect(gpt35.defaultForPlayground).toBe(true);
  });

  it("UT-LLM-010: maxOutputTokens bounds", async () => {
    const { svc } = makeService();
    let err: unknown = null;
    try {
      await svc.create(
        {
          ...baseInput,
          maxOutputTokens: 0,
          auth: { kind: "apiKey", apiKey: "k" },
        },
        ACTOR,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
  });

  it("UT-LLM-011: defaultTemperature bounds", async () => {
    const { svc } = makeService();
    let err: unknown = null;
    try {
      await svc.create(
        {
          ...baseInput,
          defaultTemperature: 2.5,
          auth: { kind: "apiKey", apiKey: "k" },
        },
        ACTOR,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
  });

  it("UT-LLM-012: GET (admin form) never returns plaintext for any kind", async () => {
    const { svc } = makeService();
    const a = await svc.create(
      { ...baseInput, name: "a", auth: { kind: "apiKey", apiKey: "sk-aabbccdd1122" } },
      ACTOR,
    );
    const masked = await svc.getForAdmin(a._id);
    if (masked?.auth.kind !== "apiKey") throw new Error("kind");
    expect(masked.auth.apiKey).not.toBe("sk-aabbccdd1122");
    expect(isMidMaskSentinel(masked.auth.apiKey)).toBe(true);
  });

  it("UT-LLM-013: sentinel apiKey on update preserves DB value", async () => {
    const { svc } = makeService();
    const created = await svc.create(
      { ...baseInput, auth: { kind: "apiKey", apiKey: "sk-real-secret-12345" } },
      ACTOR,
    );
    const masked = midMaskSecret("sk-real-secret-12345");
    await svc.update(
      created._id,
      { auth: { kind: "apiKey", apiKey: masked } },
      ACTOR,
    );
    const internal = await svc.get(created._id);
    if (internal?.auth.kind !== "apiKey") throw new Error("kind");
    expect(internal.auth.apiKey).toBe("sk-real-secret-12345");
  });
});
