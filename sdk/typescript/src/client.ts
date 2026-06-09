/**
 * Ornn HTTP client.
 *
 * Thin wrapper over `fetch` that handles:
 *   - Path prefixing (every call hits `/api/v1/...`; the SDK never encodes paths elsewhere)
 *   - Auth header injection (static token, or an async `getToken` resolver for refresh flows)
 *   - Response envelope unwrapping (`{ data, error }` → `data` or `throw OrnnError`)
 *   - Structured error propagation via {@link OrnnError}
 *
 * The SDK intentionally does not hold its own auth state: callers plug
 * in whatever refresh logic they use elsewhere (NyxID SDK, OAuth
 * library, manual). For a static token, pass `token`. For dynamic
 * refresh, pass `getToken`.
 *
 * @module client
 */

import { OrnnError, type OrnnErrorPayload } from "./errors";
import type {
  ClosureNode,
  ClosureResult,
  PublishOptions,
  SkillDetail,
  SkillSearchParams,
  SkillSearchResult,
  SkillVersionEntry,
  UpdateSkillMetadata,
} from "./types";

export interface OrnnClientOptions {
  /** Base URL where the ornn frontend (and nginx) lives, e.g. `https://ornn.chrono-ai.fun`. No trailing slash. */
  readonly baseUrl: string;
  /** Static NyxID access token. Mutually exclusive with `getToken`. */
  readonly token?: string;
  /** Lazy token resolver, invoked on every request. Takes precedence over `token` if both are set. */
  readonly getToken?: () => string | Promise<string>;
  /** Custom fetch implementation (useful for tests / Node versions without global fetch). Defaults to `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
}

interface EnvelopeSuccess<T> {
  readonly data: T;
  readonly error: null;
}

/**
 * Wire shape for error responses post-#456 — RFC 7807
 * `application/problem+json`. Fields at the body root; `error` /
 * `data` are gone.
 */
interface ProblemJson {
  readonly type?: string;
  readonly title?: string;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
  readonly instance?: string;
  readonly requestId?: string;
  readonly errors?: ReadonlyArray<{ path?: string; code?: string; message: string }>;
}

export class OrnnClient {
  private readonly baseUrl: string;
  private readonly staticToken: string | undefined;
  private readonly tokenResolver: (() => string | Promise<string>) | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OrnnClientOptions) {
    if (!options.baseUrl) {
      throw new Error("OrnnClient: baseUrl is required");
    }
    // Strip ALL trailing slashes with a linear loop rather than a regex
    // (`/\/+$/`) — the regex backtracks polynomially on a pathological
    // all-slashes input, a ReDoS vector. The loop is O(n) regardless.
    let normalizedBaseUrl = options.baseUrl;
    while (normalizedBaseUrl.endsWith("/")) {
      normalizedBaseUrl = normalizedBaseUrl.slice(0, -1);
    }
    this.baseUrl = normalizedBaseUrl;
    this.staticToken = options.token;
    this.tokenResolver = options.getToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("OrnnClient: fetch is not available; pass `fetch` explicitly");
    }
  }

  // ---- Public API ----

  /** Search skills. Returns one page; for cross-page iteration use `searchAll()`. */
  async search(
    params: SkillSearchParams & { cursor?: string; limit?: number } = {},
  ): Promise<SkillSearchResult> {
    const query = new URLSearchParams();
    // Per CONVENTIONS.md §4.1 (#586) the canonical search param is `q`.
    if (params.q) query.set("q", params.q);
    if (params.scope) query.set("scope", params.scope);
    if (params.category) query.set("category", params.category);
    if (params.tag) query.set("tag", params.tag);
    if (params.runtime) query.set("runtime", params.runtime);
    if (params.mode) query.set("mode", params.mode);
    if (params.systemFilter) query.set("systemFilter", params.systemFilter);
    // Cursor pagination (#457). When `cursor` is set, server uses it
    // instead of `page`; both are still accepted for backward compat.
    if (params.cursor !== undefined) query.set("cursor", params.cursor);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.page !== undefined) query.set("page", String(params.page));
    if (params.pageSize !== undefined) query.set("pageSize", String(params.pageSize));
    const qs = query.toString();
    return this.request<SkillSearchResult>(
      "GET",
      `/skill-search${qs ? `?${qs}` : ""}`,
    );
  }

  /**
   * Auto-paginating iterator (#465). Yields every matching skill across
   * pages; fetches the next page on demand using `meta.nextCursor`:
   *
   * ```ts
   * for await (const skill of client.searchAll({ q: "pdf" })) {
   *   console.log(skill.name);
   * }
   * ```
   *
   * Stops cleanly when the server returns `meta.hasMore === false` (or
   * no `nextCursor`). Per-page errors surface as `OrnnError` and stop
   * iteration — wrap in try/catch if you want to skip-and-continue.
   */
  async *searchAll(
    params: SkillSearchParams & { limit?: number } = {},
  ): AsyncIterableIterator<SkillSearchResult["items"][number]> {
    let cursor: string | undefined;
    // Loop guard — the server contract says nextCursor only appears
    // when there's a next page, so this loop terminates naturally on
    // the last page. Cap at 10k pages defensively in case a misbehaving
    // server returns nextCursor forever; 10k pages × default limit (9)
    // is ~90k items which exceeds every realistic registry.
    for (let i = 0; i < 10_000; i++) {
      const page: SkillSearchResult = await this.search(
        cursor !== undefined ? { ...params, cursor } : params,
      );
      for (const item of page.items) yield item;
      const next = page.meta?.nextCursor;
      if (!next || page.meta?.hasMore === false) return;
      cursor = next;
    }
  }

  /** Fetch a single skill by GUID or name. */
  async get(guidOrName: string, version?: string): Promise<SkillDetail> {
    const suffix = version ? `?version=${encodeURIComponent(version)}` : "";
    return this.request<SkillDetail>(
      "GET",
      `/skills/${encodeURIComponent(guidOrName)}${suffix}`,
    );
  }

  /** List versions for a skill. */
  async listVersions(guidOrName: string): Promise<readonly SkillVersionEntry[]> {
    const res = await this.request<{ items: readonly SkillVersionEntry[] }>(
      "GET",
      `/skills/${encodeURIComponent(guidOrName)}/versions`,
    );
    return res.items;
  }

  /**
   * Download a skill package as a ZIP (ArrayBuffer).
   *
   * Returns the raw package bytes. Callers typically pipe this into
   * JSZip, write it to disk, or upload it elsewhere.
   */
  async downloadPackage(guid: string, version: string): Promise<ArrayBuffer> {
    const res = await this.rawRequest(
      "GET",
      `/skills/${encodeURIComponent(guid)}/versions/${encodeURIComponent(version)}/download`,
    );
    if (!res.ok) {
      throw await parseError(res);
    }
    return res.arrayBuffer();
  }

  /**
   * Resolve the full transitive dependency closure of a skill (#968).
   *
   * Returns the closure in deps-first topological order — every
   * dependency precedes the dependents that pin it, so iterating the
   * `items` array installs in a safe order. Throws `OrnnError` with code
   * `dependency_cycle` / `dependency_conflict` / `skill_dependency_not_found`
   * when the graph can't be resolved.
   */
  async resolveClosure(
    guidOrName: string,
    options: { version?: string } = {},
  ): Promise<ClosureResult> {
    const suffix = options.version
      ? `?version=${encodeURIComponent(options.version)}`
      : "";
    return this.request<ClosureResult>(
      "GET",
      `/skills/${encodeURIComponent(guidOrName)}/closure${suffix}`,
    );
  }

  /**
   * Resolve a skill's dependency closure and download every package in
   * the closure (#968). Convenience over {@link resolveClosure} +
   * {@link downloadPackage}: downloads in the closure's topological order
   * (dependencies first) so a caller can install each ZIP as it arrives.
   *
   * Returns the ordered closure plus the downloaded bytes per node,
   * keyed by `<name>@<version>`. Does NOT include the root skill itself —
   * pull that separately via {@link downloadPackage} if needed.
   */
  async pullClosure(
    guidOrName: string,
    options: { version?: string } = {},
  ): Promise<{
    closure: ClosureResult;
    packages: Array<{ node: ClosureNode; bytes: ArrayBuffer }>;
  }> {
    const closure = await this.resolveClosure(guidOrName, options);
    const packages: Array<{ node: ClosureNode; bytes: ArrayBuffer }> = [];
    // Sequential, in topo order — dependencies download before their
    // dependents so a consumer can install incrementally.
    for (const node of closure.items) {
      const bytes = await this.downloadPackage(node.guid, node.version);
      packages.push({ node, bytes });
    }
    return { closure, packages };
  }

  /** Publish a new skill from a ZIP package. */
  async publish(
    zip: Blob | ArrayBuffer | Uint8Array,
    options: PublishOptions = {},
  ): Promise<SkillDetail> {
    const body = zipToBlob(zip);
    const qs = options.skipValidation ? "?skip_validation=true" : "";
    return this.request<SkillDetail>(
      "POST",
      `/skills${qs}`,
      {
        body,
        headers: { "Content-Type": "application/zip" },
      },
    );
  }

  /**
   * Update an existing skill's metadata or package.
   *
   * Pass a `zip` to publish a new version. Pass `metadata` to update
   * fields without touching the package contents.
   */
  async update(
    id: string,
    args: { metadata?: UpdateSkillMetadata; zip?: Blob | ArrayBuffer | Uint8Array } & PublishOptions,
  ): Promise<SkillDetail> {
    const qs = args.skipValidation ? "?skip_validation=true" : "";
    if (args.zip) {
      return this.request<SkillDetail>("PUT", `/skills/${encodeURIComponent(id)}${qs}`, {
        body: zipToBlob(args.zip),
        headers: { "Content-Type": "application/zip" },
      });
    }
    return this.request<SkillDetail>("PUT", `/skills/${encodeURIComponent(id)}${qs}`, {
      body: JSON.stringify(args.metadata ?? {}),
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Delete a skill by ID. */
  async delete(id: string): Promise<void> {
    await this.request<{ success: boolean }>("DELETE", `/skills/${encodeURIComponent(id)}`);
  }

  // ---- Plumbing ----

  /** Escape hatch: run any HTTP request against /api/v1 with auth + envelope handling. */
  async request<T>(
    method: string,
    path: string,
    init: { body?: BodyInit; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const res = await this.rawRequest(method, path, init);
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      // Error responses are RFC 7807 (#456) — fields at the body root.
      throw buildError(res.status, body as ProblemJson | null);
    }
    // Success responses keep the `{ data, error: null }` envelope.
    const env = body as EnvelopeSuccess<T> | null;
    if (!env || env.error !== null) {
      throw new OrnnError({
        status: res.status,
        code: "unknown_error",
        message: `Ornn API returned ${res.status} with an unexpected body shape`,
      });
    }
    return env.data;
  }

  private async rawRequest(
    method: string,
    path: string,
    init: { body?: BodyInit; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const token = this.tokenResolver ? await this.tokenResolver() : this.staticToken;
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    // exactOptionalPropertyTypes (#450): `RequestInit.body` is
    // `BodyInit | null`, not optional-`undefined`. Only set the key
    // when we actually have a body so we don't pass `body: undefined`
    // (rejected under the stricter contract).
    return this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
  }
}

function zipToBlob(zip: Blob | ArrayBuffer | Uint8Array): Blob {
  if (zip instanceof Blob) return zip;
  return new Blob([zip as BlobPart], { type: "application/zip" });
}

async function parseError(res: Response): Promise<OrnnError> {
  const body = (await res.json().catch(() => null)) as ProblemJson | null;
  return buildError(res.status, body);
}

function buildError(status: number, body: ProblemJson | null): OrnnError {
  if (body && (body.code || body.detail || body.title)) {
    // exactOptionalPropertyTypes (#450): only stamp `requestId` /
    // `errors` keys when the upstream actually provided them — the
    // payload type is `requestId?: string`, not `string | undefined`,
    // so `{ requestId: undefined }` is a type error under the
    // stricter contract.
    const payload: OrnnErrorPayload = {
      status: body.status ?? status,
      code: body.code ?? "unknown_error",
      message: body.detail ?? body.title ?? `Ornn API returned ${status}`,
      ...(body.requestId !== undefined ? { requestId: body.requestId } : {}),
      ...(body.errors !== undefined ? { errors: body.errors } : {}),
    };
    return new OrnnError(payload);
  }
  return new OrnnError({
    status,
    code: "unknown_error",
    message: `Ornn API returned ${status} without a recognized error body`,
  });
}
