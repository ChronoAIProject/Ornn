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

interface EnvelopeFailure {
  readonly data: null;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId?: string;
    readonly errors?: ReadonlyArray<{ path?: string; code?: string; message: string }>;
  };
}

type Envelope<T> = EnvelopeSuccess<T> | EnvelopeFailure;

export class OrnnClient {
  private readonly baseUrl: string;
  private readonly staticToken: string | undefined;
  private readonly tokenResolver: (() => string | Promise<string>) | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OrnnClientOptions) {
    if (!options.baseUrl) {
      throw new Error("OrnnClient: baseUrl is required");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.staticToken = options.token;
    this.tokenResolver = options.getToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("OrnnClient: fetch is not available; pass `fetch` explicitly");
    }
  }

  // ---- Public API ----

  /** Search skills. Returns paginated results with `items` + pagination meta. */
  async search(params: SkillSearchParams = {}): Promise<SkillSearchResult> {
    const query = new URLSearchParams();
    if (params.q) query.set("query", params.q);
    if (params.scope) query.set("scope", params.scope);
    if (params.category) query.set("category", params.category);
    if (params.tag) query.set("tag", params.tag);
    if (params.runtime) query.set("runtime", params.runtime);
    if (params.mode) query.set("mode", params.mode);
    if (params.systemFilter) query.set("systemFilter", params.systemFilter);
    if (params.page !== undefined) query.set("page", String(params.page));
    if (params.pageSize !== undefined) query.set("pageSize", String(params.pageSize));
    const qs = query.toString();
    return this.request<SkillSearchResult>(
      "GET",
      `/skill-search${qs ? `?${qs}` : ""}`,
    );
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
    const body = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!res.ok || !body || body.error !== null) {
      throw buildError(res.status, body);
    }
    return (body as EnvelopeSuccess<T>).data;
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
    return this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
      method,
      body: init.body,
      headers,
    });
  }
}

function zipToBlob(zip: Blob | ArrayBuffer | Uint8Array): Blob {
  if (zip instanceof Blob) return zip;
  return new Blob([zip as BlobPart], { type: "application/zip" });
}

async function parseError(res: Response): Promise<OrnnError> {
  const body = (await res.json().catch(() => null)) as Envelope<unknown> | null;
  return buildError(res.status, body);
}

function buildError(status: number, body: Envelope<unknown> | null): OrnnError {
  if (body && body.error) {
    const err = body.error;
    const payload: OrnnErrorPayload = {
      status,
      code: err.code,
      message: err.message,
      requestId: err.requestId,
      errors: err.errors,
    };
    return new OrnnError(payload);
  }
  return new OrnnError({
    status,
    code: "unknown_error",
    message: `Ornn API returned ${status} without a recognized error envelope`,
  });
}
