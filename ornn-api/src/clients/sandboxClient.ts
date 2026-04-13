/**
 * HTTP client for chrono-sandbox service.
 * Supports one-shot execution, streaming, and persistent sessions.
 * @module clients/sandboxClient
 */

import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "sandboxClient" });

// ── Shared types ──────────────────────────────────────────────────────

export interface InputFile {
  path: string;
  content: string; // base64
}

export interface ResourceLimits {
  cpu?: string;
  memory?: string;
}

export interface RetrievedFile {
  path: string;
  content?: string; // base64
  size?: number;
  error?: string;
}

// ── Execute (one-shot) ────────────────────────────────────────────────

export interface SandboxExecuteParams {
  script: string;
  language: string;
  outputType?: "text" | "file";
  env?: Record<string, string>;
  dependencies?: string[];
  retrieveFiles?: string[];
  timeoutSecs?: number;
  inputFiles?: InputFile[];
  resources?: ResourceLimits;
  image?: string;
  networkEnabled?: boolean;
}

export interface SandboxExecuteResult {
  success: boolean;
  output?: {
    stdout: string;
    stderr: string;
    exit_code: number;
    display_data: Array<Record<string, unknown>>;
    files?: RetrievedFile[];
    execution_time_ms: number;
  };
  error?: {
    code: string;
    message: string;
    details?: {
      ename: string;
      evalue: string;
      traceback: string[];
    };
  };
}

// ── Streaming ─────────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "stdout"; text: string }
  | { type: "stderr"; text: string }
  | { type: "result"; data: Record<string, unknown> }
  | { type: "error"; ename: string; evalue: string; traceback: string[] }
  | { type: "complete"; exit_code: number; execution_time_ms: number };

// ── Sessions ──────────────────────────────────────────────────────────

export interface CreateSessionParams {
  language: string;
  dependencies?: string[];
  resources?: ResourceLimits;
  image?: string;
  networkEnabled?: boolean;
  ttlSecs?: number;
  env?: Record<string, string>;
  inputFiles?: InputFile[];
}

export interface SessionResponse {
  session_id: string;
  status: string;
  expires_at: number;
}

export interface SessionExecuteParams {
  script: string;
  language: string;
  outputType?: "text" | "file";
  env?: Record<string, string>;
  inputFiles?: InputFile[];
  retrieveFiles?: string[];
  timeoutSecs?: number;
}

export interface SessionInfo {
  session_id: string;
  status: string;
  created_at: number;
  expires_at: number;
  last_used_at: number;
}

export interface SessionListResponse {
  sessions: SessionInfo[];
}

// ── Client ────────────────────────────────────────────────────────────

export class SandboxClient {
  private readonly baseUrl: string;
  private readonly getAccessToken?: () => Promise<string>;

  constructor(baseUrl: string, getAccessToken?: () => Promise<string>) {
    this.baseUrl = baseUrl;
    this.getAccessToken = getAccessToken;
    logger.info({ baseUrl, authenticated: !!getAccessToken }, "SandboxClient initialized");
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (!this.getAccessToken) return {};
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  // ── One-shot execute ──────────────────────────────────────────────

  async execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult> {
    logger.info(
      { language: params.language, timeout: params.timeoutSecs, inputFiles: params.inputFiles?.length ?? 0 },
      "Executing script in sandbox",
    );

    const body: Record<string, unknown> = {
      script: params.script,
      language: params.language,
      output_type: params.outputType ?? "text",
      env: params.env ?? {},
      dependencies: params.dependencies ?? [],
      retrieve_files: params.retrieveFiles ?? [],
      timeout_secs: params.timeoutSecs ?? 60,
      input_files: params.inputFiles ?? [],
      network_enabled: params.networkEnabled ?? true,
    };
    if (params.resources) body.resources = params.resources;
    if (params.image) body.image = params.image;

    const result = await this.post<SandboxExecuteResult>("/execute", body);

    if (result.success) {
      logger.info(
        { exitCode: result.output?.exit_code, executionTimeMs: result.output?.execution_time_ms },
        "Sandbox execution completed",
      );
    } else {
      logger.warn(
        { errorCode: result.error?.code, message: result.error?.message },
        "Sandbox execution failed",
      );
    }

    return result;
  }

  // ── Streaming execute ─────────────────────────────────────────────

  async *executeStream(params: SandboxExecuteParams): AsyncGenerator<StreamEvent> {
    logger.info(
      { language: params.language, timeout: params.timeoutSecs },
      "Starting streaming execution",
    );

    const body: Record<string, unknown> = {
      script: params.script,
      language: params.language,
      output_type: params.outputType ?? "text",
      env: params.env ?? {},
      dependencies: params.dependencies ?? [],
      retrieve_files: params.retrieveFiles ?? [],
      timeout_secs: params.timeoutSecs ?? 60,
      input_files: params.inputFiles ?? [],
      network_enabled: params.networkEnabled ?? true,
    };
    if (params.resources) body.resources = params.resources;
    if (params.image) body.image = params.image;

    yield* this.streamSSE("/execute/stream", body);
  }

  // ── Session management ────────────────────────────────────────────

  async createSession(params: CreateSessionParams): Promise<SessionResponse> {
    logger.info(
      { language: params.language, ttlSecs: params.ttlSecs, deps: params.dependencies?.length ?? 0 },
      "Creating sandbox session",
    );

    const body: Record<string, unknown> = {
      language: params.language,
      dependencies: params.dependencies ?? [],
      network_enabled: params.networkEnabled ?? true,
      env: params.env ?? {},
      input_files: params.inputFiles ?? [],
    };
    if (params.resources) body.resources = params.resources;
    if (params.image) body.image = params.image;
    if (params.ttlSecs) body.ttl_secs = params.ttlSecs;

    const result = await this.post<SessionResponse>("/sessions", body);
    logger.info({ sessionId: result.session_id, expiresAt: result.expires_at }, "Session created");
    return result;
  }

  async sessionExecute(sessionId: string, params: SessionExecuteParams): Promise<SandboxExecuteResult> {
    logger.info(
      { sessionId, language: params.language, timeout: params.timeoutSecs },
      "Executing in session",
    );

    const body: Record<string, unknown> = {
      script: params.script,
      language: params.language,
      output_type: params.outputType ?? "text",
      env: params.env ?? {},
      input_files: params.inputFiles ?? [],
      retrieve_files: params.retrieveFiles ?? [],
      timeout_secs: params.timeoutSecs ?? 60,
    };

    const result = await this.post<SandboxExecuteResult>(`/sessions/${sessionId}/execute`, body);

    if (result.success) {
      logger.info(
        { sessionId, exitCode: result.output?.exit_code, executionTimeMs: result.output?.execution_time_ms },
        "Session execution completed",
      );
    } else {
      logger.warn(
        { sessionId, errorCode: result.error?.code, message: result.error?.message },
        "Session execution failed",
      );
    }

    return result;
  }

  async *sessionExecuteStream(sessionId: string, params: SessionExecuteParams): AsyncGenerator<StreamEvent> {
    logger.info(
      { sessionId, language: params.language, timeout: params.timeoutSecs },
      "Starting session streaming execution",
    );

    const body: Record<string, unknown> = {
      script: params.script,
      language: params.language,
      output_type: params.outputType ?? "text",
      env: params.env ?? {},
      input_files: params.inputFiles ?? [],
      retrieve_files: params.retrieveFiles ?? [],
      timeout_secs: params.timeoutSecs ?? 60,
    };

    yield* this.streamSSE(`/sessions/${sessionId}/execute/stream`, body);
  }

  async deleteSession(sessionId: string): Promise<void> {
    logger.info({ sessionId }, "Deleting session");

    const auth = await this.authHeaders();
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
      method: "DELETE",
      headers: auth,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error({ sessionId, status: response.status }, "Delete session failed");
      throw new Error(`Delete session failed (${response.status}): ${text}`);
    }

    logger.info({ sessionId }, "Session deleted");
  }

  async listSessions(): Promise<SessionListResponse> {
    logger.debug("Listing sessions");

    const auth = await this.authHeaders();
    const response = await fetch(`${this.baseUrl}/sessions`, { headers: auth });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`List sessions failed (${response.status}): ${text}`);
    }

    return (await response.json()) as SessionListResponse;
  }

  // ── Internal helpers ──────────────────────────────────────────────

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const auth = await this.authHeaders();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error({ path, status: response.status }, "Sandbox request failed");
      throw new Error(`Sandbox service error (${response.status}): ${text}`);
    }

    return (await response.json()) as T;
  }

  private async *streamSSE(path: string, body: Record<string, unknown>): AsyncGenerator<StreamEvent> {
    const auth = await this.authHeaders();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error({ path, status: response.status }, "Sandbox stream request failed");
      throw new Error(`Sandbox stream error (${response.status}): ${text}`);
    }

    if (!response.body) {
      throw new Error("No response body for SSE stream");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          const json = trimmed.slice(6);
          if (!json) continue;

          try {
            const event = JSON.parse(json) as StreamEvent;
            yield event;
          } catch {
            logger.debug({ raw: json.slice(0, 200) }, "Skipping unparseable SSE data");
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
