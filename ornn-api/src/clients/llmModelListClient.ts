/**
 * LLM model-list client.
 *
 * Implements the `ModelListFetcher` contract (`domains/settings/llmProviders`)
 * that the `LlmProvidersService.sync()` flow consumes. Knows how to:
 *   - Translate the provider's `auth` discriminated union into the
 *     correct HTTP `Authorization` header (Bearer for `apiKey`, OAuth2
 *     client_credentials for `tokenUrl`, Basic for `basic`).
 *   - Parse the upstream model-list payload across the supported
 *     `apiFormat` variants (`chat-completion` and `responses` both
 *     return OpenAI-shaped `{ data: [{ id, name? }, …] }`; future
 *     formats can branch on `apiFormat` here).
 *   - Surface upstream errors as a single rejected Promise — the
 *     service layer maps `{ added, updated, removed }` deltas, so a
 *     failed fetch must not return an empty array (which would look
 *     identical to "everything removed").
 *
 * Defense in depth:
 *   - Fetch-time DNS-rebind re-check via `assertPublicResolvedAddress`
 *     (`infra/url`). The Zod schema layer validates URL strings at
 *     write-time, but a public hostname can flip its DNS records to
 *     `169.254.169.254` (cloud metadata) between save and fetch. We
 *     re-resolve here right before each fetch.
 *   - Hard timeouts (15s) on every outbound request. A wedged upstream
 *     would otherwise block a Hono request slot until the kernel TCP
 *     timeout (~75s).
 *   - `Authorization` redaction in error logs. Some buggy LLM gateways
 *     echo the bearer token back in error envelopes; we strip both
 *     `bearer <jwt>` and `apiKey=<value>` patterns before logging or
 *     including the body in the rethrown error message.
 *
 * @module clients/llmModelListClient
 */

import { createLogger } from "../shared/logger";
import type {
  ApiFormat,
  LlmProviderAuth,
} from "../domains/settings/llmProviders/types";
import type { ModelListFetcher } from "../domains/settings/llmProviders/service";
import {
  assertPublicResolvedAddress,
  SsrfRefusalError,
} from "../infra/url";

const logger = createLogger("llmModelListClient");

/** Max wall-clock for a single upstream request (model-list or token-exchange). */
const FETCH_TIMEOUT_MS = 15_000;

interface RawModelEntry {
  readonly id?: string;
  readonly name?: string;
  readonly display_name?: string;
}

interface RawListResponse {
  readonly data?: ReadonlyArray<RawModelEntry>;
  readonly models?: ReadonlyArray<RawModelEntry>;
  readonly items?: ReadonlyArray<RawModelEntry>;
}

/**
 * Strip leaked credentials from upstream response bodies before they
 * land in logs or error messages. Targets the two envelope shapes we've
 * seen in the wild: `Bearer <jwt>` echoed in 401 messages, and
 * `apiKey=...` in OAuth2-style query-param error responses.
 *
 * Conservative regex — false positives turn into `[REDACTED]` rather
 * than data leakage.
 */
function redactCredentials(body: string): string {
  return body
    .replace(/bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [REDACTED]")
    .replace(/api[_-]?key\s*[=:]\s*[A-Za-z0-9._\-+/=]+/gi, "apiKey=[REDACTED]")
    .replace(/"(access_token|api_key|apiKey|token)"\s*:\s*"[^"]*"/g, '"$1":"[REDACTED]"');
}

/**
 * Pre-flight SSRF check + AbortSignal wrapper around `fetch`. Centralised
 * so the model-list and OAuth2 token-exchange paths share one
 * implementation.
 */
async function safeFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: '${url}'`);
  }
  await assertPublicResolvedAddress(parsed.hostname);

  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal });
}

export class LlmModelListClient implements ModelListFetcher {
  /**
   * Fetch the upstream catalog. Returns `[{ id, displayName }]` —
   * `displayName` falls back to `id` when the upstream omits a label.
   *
   * Throws on any non-2xx or transport failure so the service layer
   * marks the sync as "failed" rather than treating "no models" as a
   * legitimate empty catalog (which would mark every existing model as
   * `removed`).
   */
  async fetch(args: {
    modelListUrl: string;
    apiFormat: ApiFormat;
    auth: LlmProviderAuth;
  }): Promise<ReadonlyArray<{ id: string; displayName: string }>> {
    if (!args.modelListUrl || args.modelListUrl.trim().length === 0) {
      throw new Error("LLM model-list URL is empty — configure it in /admin/settings/llm-providers");
    }
    const headers = await this.buildAuthHeaders(args.auth);

    let resp: Response;
    try {
      resp = await safeFetch(args.modelListUrl, { headers });
    } catch (err) {
      // Distinguish SSRF refusal (operator-actionable) from generic
      // transport failures so the admin "Refresh" toast can render
      // a meaningful message.
      if (err instanceof SsrfRefusalError) {
        logger.error(
          { url: args.modelListUrl, err: err.message },
          "LLM model-list fetch refused by SSRF guard",
        );
        throw err;
      }
      const msg = (err as Error).message ?? String(err);
      logger.error(
        { url: args.modelListUrl, err: msg },
        "LLM model-list fetch threw",
      );
      // `AbortSignal.timeout` throws `DOMException: TimeoutError` on
      // timeout; surface as a friendly 504-ish error.
      const wrapped =
        (err as Error).name === "TimeoutError"
          ? new Error(
              `Model-list fetch timed out after ${FETCH_TIMEOUT_MS}ms`,
              { cause: err },
            )
          : new Error(`Model-list fetch failed: ${msg}`, { cause: err });
      throw wrapped;
    }

    if (!resp.ok) {
      const rawBody = await resp.text().catch(() => "");
      const body = redactCredentials(rawBody).slice(0, 200);
      logger.error(
        { url: args.modelListUrl, status: resp.status, body },
        "LLM model-list returned non-2xx",
      );
      throw new Error(`Model-list fetch failed (${resp.status}): ${body}`);
    }

    const json = (await resp.json().catch(() => null)) as
      | RawListResponse
      | ReadonlyArray<RawModelEntry>
      | null;
    if (!json) {
      throw new Error("Model-list response was not valid JSON");
    }

    let raw: ReadonlyArray<RawModelEntry>;
    if (Array.isArray(json)) {
      raw = json;
    } else {
      const obj = json as RawListResponse;
      raw = obj.data ?? obj.models ?? obj.items ?? [];
    }

    const out: Array<{ id: string; displayName: string }> = [];
    for (const m of raw) {
      const id = m.id?.trim();
      if (!id) continue;
      const label = m.display_name?.trim() || m.name?.trim() || id;
      out.push({ id, displayName: label });
    }
    logger.info(
      { url: args.modelListUrl, count: out.length, apiFormat: args.apiFormat },
      "LLM model-list fetched",
    );
    return out;
  }

  /**
   * Translate the provider's `auth` discriminated union into request
   * headers. For `tokenUrl` flows the OAuth2 client_credentials
   * exchange is performed inline — no token caching here, callers are
   * the rare admin-clicks-refresh path so the per-fetch token cost is
   * acceptable.
   */
  private async buildAuthHeaders(
    auth: LlmProviderAuth,
  ): Promise<Record<string, string>> {
    if (auth.kind === "apiKey") {
      return auth.apiKey ? { authorization: `Bearer ${auth.apiKey}` } : {};
    }
    if (auth.kind === "basic") {
      if (!auth.username) return {};
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
      return { authorization: `Basic ${encoded}` };
    }
    if (auth.kind === "tokenUrl") {
      if (!auth.tokenUrl) return {};
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
      });
      let tokenResp: Response;
      try {
        tokenResp = await safeFetch(auth.tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
      } catch (err) {
        if (err instanceof SsrfRefusalError) {
          logger.error(
            { tokenUrl: auth.tokenUrl, err: err.message },
            "OAuth2 token exchange refused by SSRF guard",
          );
          throw err;
        }
        const msg = (err as Error).message ?? String(err);
        const wrapped =
          (err as Error).name === "TimeoutError"
            ? new Error(
                `OAuth2 token exchange timed out after ${FETCH_TIMEOUT_MS}ms`,
                { cause: err },
              )
            : new Error(`OAuth2 token exchange failed: ${msg}`, { cause: err });
        throw wrapped;
      }
      if (!tokenResp.ok) {
        const rawText = await tokenResp.text().catch(() => "");
        const text = redactCredentials(rawText).slice(0, 200);
        throw new Error(
          `OAuth2 token exchange failed (${tokenResp.status}): ${text}`,
        );
      }
      const json = (await tokenResp.json()) as { access_token?: string };
      if (!json.access_token) {
        throw new Error("OAuth2 token response missing access_token");
      }
      return { authorization: `Bearer ${json.access_token}` };
    }
    return {};
  }
}
