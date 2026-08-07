/**
 * LLM-backed streaming surfaces: skill generation, the playground agent
 * loop, and the Ornn assistant (#1214).
 *
 * Everything in this module shares one shape and one cost model:
 *
 *   - The success response is **always** a `text/event-stream`, never the
 *     `{ data, error }` envelope. The envelope only ever appears on the
 *     other domains' JSON endpoints; here a 200 means "the stream opened",
 *     not "the work succeeded".
 *   - Every request runs through the same pre-stream gauntlet — auth →
 *     route scope → burst rate limit (where mounted) → body validation →
 *     model resolution → quota reserve. Every one of those gates fails
 *     with an ordinary RFC 7807 `application/problem+json` body and a 4xx/5xx
 *     status **before** a single SSE byte is written. Integrators MUST check
 *     the HTTP status (and `Content-Type`) before attaching an SSE parser.
 *   - Once the stream is open, failures arrive *inside* the stream as an
 *     error event on a 200 response. A terminal in-stream error is not an
 *     HTTP error and will never retro-actively change the status code.
 *   - Each request reserves one per-user monthly quota slot on its surface
 *     (`skillGen` / `playground` / `assistant`) before the stream opens and
 *     reconciles it when the stream ends. Reconciliation is *not* uniform:
 *     on `playground` and `assistant` an abort after the provider has
 *     emitted billable output still consumes the slot (the upstream tokens
 *     are already paid for), while `skillGen` decides purely from the frames
 *     it emitted and refunds any abort. Each operation states its own rule.
 *
 * @module openapi/paths/generation
 */

import {
  bearerAuth,
  jsonBody,
  problemResponses,
  sseResponse,
  type JsonSchema,
  type PathMap,
} from "../helpers";
import { assistantChatRequestSchema } from "../../domains/assistant/routes";

/**
 * Per-message / per-prompt character ceiling enforced by the JSON branch
 * of every surface here. Mirrors `MAX_GENERATION_CHARS`
 * (`domains/skills/generation/routes.ts`), `MAX_CHAT_MESSAGE_CHARS`
 * (`domains/playground/routes.ts`, `domains/assistant/routes.ts`) and the
 * web client's `MAX_INPUT_CHARS`. ~8k tokens at 4 chars/token.
 */
const MAX_MESSAGE_CHARS = 32_000;

// ---------------------------------------------------------------------------
// Request bodies
//
// None of the five handlers exposes an exported Zod schema except the
// assistant's, so the shapes below are hand-written from the inline
// `validateBody(z.object({...}))` declarations (from-source, from-openapi,
// playground) and from the manual parse in the hybrid `/skills/generate`
// handler. (They are NOT taken from the old hand-mirrored
// `openapi/schemas.ts`, which #1214 deleted — its copies had drifted:
// `generateJsonBodySchema` still said `model` where the handler reads
// `modelId`, and its playground body was missing `modelId` entirely.)
// ---------------------------------------------------------------------------

const modelIdProperty: JsonSchema = {
  type: "string",
  description:
    "Optional admin-curated model id. Omit to use the surface's default model. When supplied it must be a model an administrator has enabled for this surface — an unknown id fails with 400 `MODEL_NOT_FOUND`, a known-but-disabled id with 400 `MODEL_NOT_ENABLED`. Enumerate the ids you may pass with `GET /api/v1/me/models?surface=<surface>`.",
  examples: ["gpt-4.1-mini"],
};

const generateJsonBody: JsonSchema = {
  type: "object",
  description:
    "Send exactly one of `prompt` (single-turn) or `messages` (multi-turn). If both are present `messages` wins and `prompt` is ignored. Unparseable JSON, a JSON array, or a JSON scalar fails with 400 `invalid_body`; an empty body is read as `{}`, so it gets past that check and fails with 400 `missing_prompt` instead.",
  properties: {
    prompt: {
      type: "string",
      maxLength: MAX_MESSAGE_CHARS,
      description: `Single-turn natural-language description of the skill to build. Rejected with 400 \`prompt_too_long\` above ${MAX_MESSAGE_CHARS} characters.`,
      examples: ["Build a skill that extracts tables from a PDF and returns them as CSV."],
    },
    messages: {
      type: "array",
      description:
        "Multi-turn conversation history for iterative refinement — resend the whole transcript on every turn, the server holds no session state. Takes precedence over `prompt`.",
      items: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: {
            type: "string",
            enum: ["user", "assistant"],
            description: "Who produced this turn. `assistant` turns are the model's previous replies, echoed back verbatim.",
          },
          content: {
            type: "string",
            maxLength: MAX_MESSAGE_CHARS,
            description: `Turn text. Any single turn longer than ${MAX_MESSAGE_CHARS} characters fails the whole request with 400 \`content_too_long\`.`,
          },
        },
      },
    },
    modelId: modelIdProperty,
  },
};

const generateMultipartBody: JsonSchema = {
  type: "object",
  required: ["prompt"],
  description:
    "Multipart form. Use this encoding only when you want to seed generation with an existing package; otherwise prefer `application/json`. `messages` is not available on this encoding, and the server does not length-check `prompt` here — keep it under the same 32 000-character budget yourself.",
  properties: {
    prompt: {
      type: "string",
      description:
        "Natural-language description of the skill to build, or — when `package` is attached — of the modification to apply to it. Missing or empty fails with 400 `missing_prompt`.",
    },
    modelId: {
      type: "string",
      description: "Same semantics as the JSON body's `modelId`. Sent as a plain form field.",
    },
    package: {
      type: "string",
      format: "binary",
      description:
        "Optional existing skill package ZIP. The server reads only `SKILL.md` plus anything under `scripts/`, `references/` and `assets/` (a single top-level wrapper folder is unwrapped, `__MACOSX/` ignored), concatenates the text, and prepends it to the prompt as context. Unreadable/binary entries are skipped silently; a ZIP that cannot be opened at all surfaces as 500.",
    },
  },
};

const fromSourceBody: JsonSchema = {
  type: "object",
  description:
    "Provide exactly one source: `code` for inline text, or `repoUrl` for a public GitHub repository the server fetches for you. Neither fails with 400 `missing_source`; both fails with 400 `AMBIGUOUS_SOURCE`.",
  properties: {
    code: {
      type: "string",
      description:
        "Inline source, typically several route/controller/handler files concatenated. Prefix each file with a `// FILE: <path>` marker so the model can attribute endpoints to files — that is exactly the layout the `repoUrl` fetcher produces. Whitespace-only content fails with 400 `empty_source`.",
      examples: ["// FILE: src/routes/users.ts\nrouter.get('/users/:id', getUser)\n"],
    },
    repoUrl: {
      type: "string",
      format: "uri",
      description:
        "Public GitHub URL — `https://github.com/{owner}/{repo}` or `https://github.com/{owner}/{repo}/tree/{ref}/{subpath}`. Only the `github.com` host is accepted, and the fetch is unauthenticated (GitHub's 60 requests/hour/IP anonymous budget applies), so private repositories and rate-limit exhaustion both come back as 400 `repo_fetch_failed`.",
      examples: ["https://github.com/honojs/hono/tree/main/src/middleware"],
    },
    path: {
      type: "string",
      description:
        "Repository sub-directory to harvest, overriding any `/tree/{ref}/{subpath}` in `repoUrl`. When neither is given the fetcher probes, in order: `src/routes`, `src/controllers`, `src/handlers`, `src/api`, `src/app/api`, `routes`, `controllers`, `app`, and uses the first that yields files. At most 8 files of at most 16 KiB each are pulled, and only `.ts` `.tsx` `.js` `.mjs` `.py` `.go` `.java` `.rb` `.rs` are considered — point this at the directory that actually holds your handlers rather than the repo root.",
      examples: ["src/api/v2"],
    },
    framework: {
      type: "string",
      description:
        "Optional framework hint that short-circuits auto-detection. Free-form; the model reads it as prose. Only used when it cannot be inferred from the fetched files.",
      examples: ["fastapi"],
    },
    description: {
      type: "string",
      description:
        "Optional free-form context appended to the prompt — auth model, base URL, which endpoints matter, anything the source alone does not reveal.",
    },
    modelId: modelIdProperty,
  },
};

const fromOpenApiBody: JsonSchema = {
  type: "object",
  required: ["spec"],
  properties: {
    spec: {
      type: "string",
      minLength: 1,
      description:
        "The complete OpenAPI document as a **string** (JSON or YAML, either version) — not a parsed object. It is inlined verbatim into the LLM prompt, so a large spec consumes the model's context budget directly; for anything sizeable, hand-trim it to the operations you care about (or use `endpoints`) before sending.",
      examples: ["{\"openapi\":\"3.1.0\",\"info\":{\"title\":\"Billing\",\"version\":\"1\"},\"paths\":{ }}"],
    },
    endpoints: {
      type: "array",
      description:
        "Optional allow-list narrowing the generated reference to a subset of operations. The server joins the entries with `, ` into a `Focus ONLY on these endpoints:` instruction, so send plain strings such as `GET /v1/invoices`. The validator accepts any JSON value here and does not check element types — non-string entries stringify into unusable prompt text, so send strings.",
      items: { type: "string" },
      examples: [["GET /v1/invoices", "POST /v1/invoices"]],
    },
    description: {
      type: "string",
      description:
        "Optional free-form context appended to the prompt — how to authenticate, environment base URLs, which workflows the skill should make easy.",
    },
    modelId: modelIdProperty,
  },
};

const playgroundMessage: JsonSchema = {
  type: "object",
  required: ["role", "content"],
  properties: {
    role: {
      type: "string",
      enum: ["user", "assistant", "tool", "system"],
      description:
        "Turn author. Replay the transcript you received: `assistant` turns that requested tools carry `toolCalls`, and each `tool` turn answering one carries the matching `toolCallId`.",
    },
    content: {
      type: "string",
      maxLength: MAX_MESSAGE_CHARS,
      description: `Turn text — for a \`tool\` turn, the serialized tool result. Any turn longer than ${MAX_MESSAGE_CHARS} characters fails the request with 400 \`VALIDATION_ERROR\`.`,
    },
    toolCalls: {
      type: "array",
      description: "Tool invocations the model requested on this `assistant` turn. Copy back exactly what the `tool-call` events delivered.",
      items: {
        type: "object",
        required: ["id", "name", "args"],
        properties: {
          id: { type: "string", description: "Correlates with the answering turn's `toolCallId`." },
          name: { type: "string", description: "Tool name, e.g. `load_skill` or `execute_in_sandbox`." },
          args: { type: "object", additionalProperties: true, description: "Arguments the model produced for the call." },
        },
      },
    },
    toolCallId: {
      type: "string",
      description: "On a `tool` turn, the `toolCalls[].id` this result answers.",
    },
  },
};

const playgroundChatBody: JsonSchema = {
  type: "object",
  required: ["messages"],
  properties: {
    messages: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      description:
        "Full conversation transcript, oldest first. The server keeps no session state — resend everything each turn. Between 1 and 100 turns.",
      items: playgroundMessage,
    },
    skillId: {
      type: "string",
      description:
        "Optional skill GUID or name to bind the session to. Its package is injected into the model's context up front, so the agent can use the skill without spending a `load_skill` round-trip. Resolution is strict, not best-effort: an id that does not exist — or one your visibility does not let you read, which answers identically so existence is never leaked — aborts the run before the first model call. The stream still opens with 200 but carries only `error` (`message` = `Failed to load skill: Skill '<id>' not found`) followed by `finish` with `finishReason: \"error\"`. Binding also records a `playground` pull in analytics.",
      examples: ["pdf-table-extract"],
    },
    envVars: {
      type: "object",
      additionalProperties: { type: "string" },
      description:
        "Environment variables handed to sandbox executions started by this session, keyed by variable name. Scoped to this request only — nothing is persisted. Values are frequently credentials: send them over TLS, never log the request body, and prefer short-lived tokens.",
      examples: [{ API_BASE_URL: "https://api.acme.dev", REPORT_TZ: "UTC" }],
    },
    modelId: modelIdProperty,
  },
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Shared tail of every generation description: the event vocabulary, the
 * shape of `generation_complete.raw`, and what the caller still has to do
 * with it. Repeated per operation because an agent typically reads one
 * operation object in isolation.
 */
const GENERATION_STREAM_CONTRACT =
  "Frames are plain `data:` lines carrying a JSON object with a `type` field — there is no SSE `event:` line on payload frames, so dispatch on `type` and not on the parser's event name. Vocabulary: `generation_start` (LLM call opened), `token` (`content` = incremental text, emit-as-you-go), `validation_error` (`message`, `retrying`), `generation_complete` (`raw` = the model's full output), `error` (`message`, terminal). Separate keep-alive frames named `keepalive` with an empty payload arrive every `skillGen.sseKeepAliveMs` (admin-settable, 15 000 ms fallback) — ignore them. `raw` is a JSON **document string**, not a ZIP and not markdown: parse it to get `{ name, description, category, tags, readmeBody, runtimes, dependencies, envVars, scripts[], outputType? }`. Nothing is persisted — assemble the package yourself and `POST /api/v1/skills` to publish it.";

const GENERATION_COST_CONTRACT =
  "Requires the `ornn:skill:build` scope. One per-user monthly `skillGen` quota slot is reserved before the stream opens and reconciled when it ends, purely from what the stream emitted: the slot is consumed if and only if a `generation_complete` or a `validation_error` frame went out, and released in every other case. Two consequences worth designing for — a run that ends on `error` without a preceding `validation_error` costs nothing, and disconnecting mid-stream also costs nothing no matter how many `token` frames you already consumed (unlike `/playground/chat` and `/assistant/chat`, this surface has no abort-after-billable-output commit); conversely a single-turn run whose retry also fails validation consumes the slot even though you never received `generation_complete`. Model resolution and the quota check both run before the first byte, so their failures are ordinary JSON errors — never a truncated stream.";

function generateOperation(): Record<string, unknown> {
  return {
    summary: "Generate a skill package from a prompt (SSE stream)",
    description:
      "Streams an LLM-authored skill package from a natural-language brief. This is the front door of the generation family; use `/skills/generate/from-source` when you already have backend code and `/skills/generate/from-openapi` when you already have a spec. " +
      "The endpoint is hybrid on `Content-Type`. With `application/json` you send either `prompt` (single-turn) or `messages` (multi-turn refinement — resend the whole transcript, the server is stateless); with `multipart/form-data` you send a `prompt` field plus an optional `package` ZIP whose text files are read and prepended as context, which is how you ask for a modification of an existing skill rather than a fresh one. Any other content type is rejected with 400 `invalid_content_type`. " +
      "Retry behaviour differs by mode and is worth handling explicitly: the single-turn `prompt` path re-asks the model once when the first answer is not valid JSON (you see `validation_error` with `retrying: true`) and may then end on `error` with no `generation_complete` at all, while the multi-turn `messages` path does not retry — it emits `validation_error` with `retrying: false` and still emits `generation_complete` carrying output that failed validation, so re-validate `raw` before trusting it. " +
      GENERATION_STREAM_CONTRACT +
      " " +
      GENERATION_COST_CONTRACT +
      " A per-user burst limiter of 20 requests/minute applies; every response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`, and a rejection adds `Retry-After`.",
    operationId: "generateSkill",
    tags: ["Generation"],
    security: bearerAuth(),
    parameters: [],
    requestBody: {
      required: true,
      description:
        "Either a JSON brief (`prompt` or `messages`) or a multipart form (`prompt` plus an optional package ZIP to modify).",
      content: {
        "application/json": {
          schema: generateJsonBody,
          example: {
            prompt: "Build a skill that extracts tables from a PDF and returns them as CSV.",
            modelId: "gpt-4.1-mini",
          },
        },
        "multipart/form-data": { schema: generateMultipartBody },
      },
    },
    responses: {
      ...sseResponse(
        "The stream is open. A 200 means the request passed every gate and the LLM call started — it does not mean generation succeeded; watch for `generation_complete` versus a terminal `error`.",
        ["generation_start", "token", "validation_error", "generation_complete", "error", "keepalive"],
      ),
      ...problemResponses(
        {
          400:
            "Rejected before the stream opened. Codes: `invalid_content_type` (neither JSON nor multipart), `invalid_body` (unparseable JSON, or valid JSON that is an array or a scalar rather than an object), `missing_prompt` (no usable `prompt` — an empty body lands here, since it is read as `{}`), `prompt_too_long` / `content_too_long` (over 32 000 characters), `MODEL_NOT_FOUND` / `MODEL_NOT_ENABLED` (the `modelId` you asked for is unknown, or not enabled for the `skillGen` surface).",
        },
        401,
        { 403: "`forbidden` — the token authenticated but carries no `ornn:skill:build` scope. Generation is a high-cost surface and is gated separately from ordinary skill reads." },
        {
          429:
            "Either `rate_limited` (more than 20 requests in the trailing minute for this user — consult `Retry-After`) or `quota_exceeded` (this month's `skillGen` allowance is spent). Both are raised before any LLM cost is incurred.",
        },
        {
          500:
            "`internal_error`. The realistic trigger here is a `package` attachment that is not a readable ZIP: the archive is opened before any generation gate, and a corrupt central directory surfaces as an unhandled failure rather than a validation error.",
        },
        { 503: "`MODEL_UNAVAILABLE` — no model is currently enabled for the `skillGen` surface. This is a platform configuration state, not a transient outage; retrying will not help until an administrator enables one." },
      ),
    },
  };
}

function generateFromSourceOperation(): Record<string, unknown> {
  return {
    summary: "Generate an API-reference skill from backend source code (SSE stream)",
    description:
      "Turns existing backend code into a `plain` (documentation-only, no runtime scripts) skill that teaches an agent how to call that service. Supply the code inline via `code`, or hand over a public GitHub URL via `repoUrl` and let the server harvest it — exactly one of the two, never both. " +
      "The harvester is deliberately small: it walks one directory (`path`, else the URL's `/tree/{ref}/{subpath}`, else a list of conventional route folders), takes at most 8 source files of at most 16 KiB each, concatenates them with `// FILE: <path>` markers, and infers a framework hint. Every failure mode of that fetch — not a GitHub URL, private repository, missing directory, anonymous rate limit exhausted — collapses into a single 400 `repo_fetch_failed` whose `detail` carries the underlying reason. For anything larger or non-public, fetch the files yourself and pass them as `code`. " +
      "Unlike the prompt-driven endpoint this path never retries: a model answer that fails schema validation produces `validation_error` with `retrying: false` and is still delivered in the following `generation_complete`, so validate `raw` yourself before publishing. " +
      GENERATION_STREAM_CONTRACT +
      " " +
      GENERATION_COST_CONTRACT +
      " Note that this route carries no per-minute burst limiter (unlike `POST /skills/generate`); the monthly quota is the only throttle, so a 429 here means `quota_exceeded`.",
    operationId: "generateSkillFromSource",
    tags: ["Generation"],
    security: bearerAuth(),
    parameters: [],
    requestBody: jsonBody(
      fromSourceBody,
      "Exactly one source (`code` or `repoUrl`), plus optional harvest and prompt hints.",
      {
        example: {
          repoUrl: "https://github.com/acme/billing-api",
          path: "src/routes",
          framework: "hono",
          description: "Public REST API behind an API-key header. Focus on the invoice endpoints.",
        },
      },
    ),
    responses: {
      ...sseResponse(
        "The stream is open and the source has already been resolved — any repository fetch happened before this response, so a 200 guarantees the model saw non-empty code.",
        ["generation_start", "token", "validation_error", "generation_complete", "error", "keepalive"],
      ),
      ...problemResponses(
        {
          400:
            "Codes: `invalid_from_source_body` (body failed schema validation — see `detail`), `missing_source` (neither `code` nor `repoUrl`), `AMBIGUOUS_SOURCE` (both supplied), `repo_fetch_failed` (GitHub URL unrecognised, repository/path unreachable, or anonymous rate limit exhausted), `empty_source` (the resolved code is blank), `MODEL_NOT_FOUND` / `MODEL_NOT_ENABLED` (bad or disabled `modelId` for the `skillGen` surface).",
        },
        401,
        { 403: "`forbidden` — the token lacks the `ornn:skill:build` scope required by every generation endpoint." },
        { 429: "`quota_exceeded` — this month's `skillGen` allowance is spent. Raised before any LLM cost; there is no per-minute limiter on this route." },
        { 503: "`MODEL_UNAVAILABLE` — no model is enabled for the `skillGen` surface. Requires an administrator to enable one; retrying will not clear it." },
      ),
    },
  };
}

function generateFromOpenApiOperation(): Record<string, unknown> {
  return {
    summary: "Generate an API-reference skill from an OpenAPI spec (SSE stream)",
    description:
      "Converts an OpenAPI document into a `plain` (documentation-only) skill that teaches an agent how to call the described API. This is the highest-fidelity member of the generation family — prefer it over `/skills/generate/from-source` whenever a spec exists, because the model reads declared schemas instead of inferring them from handler code. " +
      "`spec` is the document as a raw string (JSON or YAML) and is inlined verbatim into the prompt, so it competes with the model's context budget: for a large surface, narrow it with `endpoints` (an allow-list of `METHOD /path` strings) or pre-trim the document. `description` adds context the spec cannot express, such as how to obtain credentials. " +
      "Like the from-source path this never retries — a schema-invalid answer yields `validation_error` with `retrying: false` and is still delivered in `generation_complete`, so re-validate `raw` before you publish it. " +
      GENERATION_STREAM_CONTRACT +
      " " +
      GENERATION_COST_CONTRACT +
      " No per-minute burst limiter is mounted on this route; the monthly quota is the only throttle.",
    operationId: "generateSkillFromOpenApi",
    tags: ["Generation"],
    security: bearerAuth(),
    parameters: [],
    requestBody: jsonBody(
      fromOpenApiBody,
      "The OpenAPI document as a string, plus optional endpoint narrowing and extra context.",
      {
        example: {
          spec: "openapi: 3.1.0\ninfo:\n  title: Billing\n  version: '1'\npaths:\n  /v1/invoices:\n    get: { summary: List invoices }\n",
          endpoints: ["GET /v1/invoices"],
          description: "Authenticate with `Authorization: Bearer <token>`; sandbox base URL is https://sandbox.acme.dev.",
        },
      },
    ),
    responses: {
      ...sseResponse(
        "The stream is open. The spec is not parsed or validated server-side — it is handed to the model as text — so a malformed document produces a poor skill rather than an HTTP error.",
        ["generation_start", "token", "validation_error", "generation_complete", "error", "keepalive"],
      ),
      ...problemResponses(
        {
          400:
            "Codes: `invalid_from_openapi_body` (body failed schema validation — most often a missing or empty `spec`, or `spec` sent as an object instead of a string; see `detail`), `MODEL_NOT_FOUND` / `MODEL_NOT_ENABLED` (bad or disabled `modelId` for the `skillGen` surface).",
        },
        401,
        { 403: "`forbidden` — the token lacks the `ornn:skill:build` scope required by every generation endpoint." },
        { 429: "`quota_exceeded` — this month's `skillGen` allowance is spent. Raised before any LLM cost; there is no per-minute limiter on this route." },
        { 503: "`MODEL_UNAVAILABLE` — no model is enabled for the `skillGen` surface. Requires an administrator to enable one." },
      ),
    },
  };
}

function playgroundChatOperation(): Record<string, unknown> {
  return {
    summary: "Run the playground agent loop (SSE stream)",
    description:
      "Drives the agentic playground: a tool-using chat loop that can load a skill and execute code in an isolated sandbox on the caller's behalf. This is the only surface in the API that runs user-supplied code, which is why it sits behind its own `ornn:playground:use` scope. Use `/assistant/chat` instead when you only want grounded answers with no execution, and the generation endpoints when you want a skill authored rather than run. " +
      "The server is stateless across requests: send the entire transcript in `messages` (1–100 turns, 32 000 characters each) every time, including the `assistant` turns that carried `toolCalls` and the `tool` turns that answered them. `skillId` pre-loads a skill's package into context, saving a `load_skill` round-trip — but it is a hard dependency, not a hint: if the id is unknown or your visibility does not permit reading it (both answer as not-found, so existence is never leaked), the run ends before the model is called. You still get a 200 stream, carrying only `error` (`Failed to load skill: …`) and `finish` with `finishReason: \"error\"`, and the reserved quota slot is released. `envVars` are forwarded to sandbox executions for this request only and are never persisted. " +
      "Stream shape: payload frames are bare `data:` lines holding a JSON object with a `type` field, and unlike the assistant they carry no SSE `event:` line, so dispatch on `type`. Vocabulary (kebab-case, distinct from the snake_case used elsewhere): `text-delta` (`delta`), `tool-call` (`toolCall` = `{ id, name, args }`), `tool-result` (`toolCallId`, `result`), `file-output` (`file` = `{ path, content, size, mimeType }`), `error` (`message`) and `finish` (`finishReason`). `error` is not the end of the stream here: the agent loop always follows it with a `finish` carrying `finishReason` `error` or `abort`, so treat `finish` as the terminator and `stop` as the only clean ending. (A bare trailing `error` with no `finish` means the server-side loop itself blew up.) Every one of these still arrives on the same 200. The very first frame is a ~2 KB SSE comment used to punch through buffering proxies and `: keepalive <epoch-ms>` comments follow at the admin-configured interval — ignore all comment frames. " +
      "Cost: 20 requests/minute per user (`RateLimit-*` headers on every response, `Retry-After` on rejection) plus one monthly `playground` quota slot, reserved before the stream opens and committed once genuinely billable output (a non-empty delta, a tool call, a tool result, a file) has been produced — aborting after that point does not refund it.",
    operationId: "playgroundChat",
    tags: ["Playground"],
    security: bearerAuth(),
    parameters: [],
    requestBody: jsonBody(
      playgroundChatBody,
      "Full conversation transcript plus optional skill binding, sandbox environment variables, and model override.",
      {
        example: {
          messages: [{ role: "user", content: "Use the pdf-table-extract skill on this invoice and show me the CSV." }],
          skillId: "pdf-table-extract",
          envVars: { REPORT_TZ: "UTC" },
        },
      },
    ),
    responses: {
      ...sseResponse(
        "The stream is open. A 200 only means every pre-stream gate passed; an in-stream `error` event still arrives on this same 200 response.",
        ["text-delta", "tool-call", "tool-result", "file-output", "error", "finish"],
      ),
      ...problemResponses(
        {
          400:
            "Codes: `VALIDATION_ERROR` (body failed schema validation — empty or >100 `messages`, an unknown `role`, a turn over 32 000 characters; see `detail`), `MODEL_NOT_FOUND` / `MODEL_NOT_ENABLED` (the `modelId` is unknown, or not enabled for the `playground` surface).",
        },
        401,
        { 403: "`forbidden` — the token lacks the `ornn:playground:use` scope. The playground executes code, so it is gated separately from read-only surfaces." },
        {
          429:
            "Either `rate_limited` (more than 20 requests in the trailing minute for this user — the limiter runs ahead of body validation, so malformed floods are also throttled) or `quota_exceeded` (this month's `playground` allowance is spent).",
        },
        { 503: "`MODEL_UNAVAILABLE` — no model is enabled for the `playground` surface. An administrator must enable one." },
      ),
    },
  };
}

function assistantChatOperation(): Record<string, unknown> {
  return {
    summary: "Ask the Ornn assistant a grounded question (SSE stream)",
    description:
      "A read-only, non-agentic Q&A stream about Ornn itself and about the skills the caller is allowed to see. Every answer is grounded in a curated knowledge-base digest plus a visibility-scoped skill retrieval that exposes only safe fields (`name`, `description`, `tags`, `category`, `createdOn`, author user id) — no emails, storage keys, sharing lists, or private-membership data ever reach the model. It runs no tools, executes nothing, and mutates nothing; reach for `/playground/chat` when you need execution and for the generation endpoints when you need a skill authored. " +
      "This is the one LLM surface here that needs no extra scope — any authenticated bearer token may call it, so a 403 is not part of its contract. The server keeps no session state: resend the full transcript in `messages` (1–100 turns, `user`/`assistant` only, 32 000 characters per turn) on every request. " +
      "Stream shape follows CONVENTIONS §6.3 exactly: each payload frame carries a native `event:` line whose name equals the JSON payload's `type`, so either dispatch style works. Vocabulary: `chat_start` (`model` = the resolved model id), `chat_text_delta` (`delta`), `chat_error` (`code`, `message` — terminal, still on a 200 response) and `chat_finish` (optional `usage` = `{ inputTokens, outputTokens, totalTokens }`). The opening ~2 KB comment frame and the periodic `: keepalive <epoch-ms>` comments are anti-buffering padding — ignore them. " +
      "Cost: 30 requests/minute per user (`RateLimit-*` on every response, `Retry-After` on rejection) and one monthly `assistant` quota slot, reserved before the stream opens; once tokens have streamed, an abort commits the slot rather than refunding it.",
    operationId: "assistantChat",
    tags: ["Assistant"],
    security: bearerAuth(),
    parameters: [],
    requestBody: jsonBody(
      assistantChatRequestSchema,
      "Full conversation transcript (`user` / `assistant` turns only) and an optional model override.",
      {
        example: {
          messages: [{ role: "user", content: "Which of my skills can parse PDFs, and how do I publish a new version?" }],
        },
      },
    ),
    responses: {
      ...sseResponse(
        "The stream is open. Model resolution and the quota reserve already succeeded, so any later failure arrives as a `chat_error` event on this 200 rather than as an HTTP error.",
        ["chat_start", "chat_text_delta", "chat_error", "chat_finish"],
        // The assistant is the one stream that emits a native `event:` line
        // (assistant/routes.ts writes `event: <type>\ndata: <json>`); the
        // generation and playground streams send bare `data:` frames.
        "named-events",
      ),
      ...problemResponses(
        {
          400:
            "Codes: `VALIDATION_ERROR` (body failed schema validation — empty or >100 `messages`, a role other than `user`/`assistant`, a turn over 32 000 characters; see `detail`), `MODEL_NOT_FOUND` / `MODEL_NOT_ENABLED` (the `modelId` is unknown, or not enabled for the `assistant` surface).",
        },
        401,
        {
          429:
            "Either `rate_limited` (more than 30 requests in the trailing minute for this user — the limiter runs ahead of body validation) or `quota_exceeded` (this month's `assistant` allowance is spent).",
        },
        { 503: "`MODEL_UNAVAILABLE` — no model is enabled for the `assistant` surface. An administrator must enable one before the assistant answers." },
      ),
    },
  };
}

/**
 * All LLM-streaming operations, keyed by their full `/api/v1` path.
 *
 * `prefix` is the API mount point (`/api/v1`) supplied by the spec
 * builder; the path tails below must match the Hono registrations in
 * `domains/skills/generation/routes.ts`, `domains/playground/routes.ts`
 * and `domains/assistant/routes.ts` character for character — a contract
 * test reflects the booted router against this map.
 */
export function generationPaths(prefix: string): PathMap {
  return {
    [`${prefix}/skills/generate`]: { post: generateOperation() },
    [`${prefix}/skills/generate/from-source`]: { post: generateFromSourceOperation() },
    [`${prefix}/skills/generate/from-openapi`]: { post: generateFromOpenApiOperation() },
    [`${prefix}/playground/chat`]: { post: playgroundChatOperation() },
    [`${prefix}/assistant/chat`]: { post: assistantChatOperation() },
  };
}
