/**
 * HTTP client for chrono-sandbox service.
 * Executes skill scripts in isolated containers.
 * @module clients/sandboxClient
 */

import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "sandboxClient" });

export interface SandboxExecuteParams {
  script: string;
  language: string;
  outputType?: "text" | "file";
  env?: Record<string, string>;
  packageUrl?: string;
  dependencies?: string[];
  retrieveFiles?: string[];
  timeoutSecs?: number;
}

export interface SandboxExecuteResult {
  success: boolean;
  output?: {
    stdout: string;
    stderr: string;
    exit_code: number;
    files?: Array<{
      path: string;
      content: string; // base64
      size: number;
      error?: string;
    }>;
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

export class SandboxClient {
  constructor(private readonly baseUrl: string) {
    logger.info({ baseUrl }, "SandboxClient initialized");
  }

  async execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult> {
    logger.info(
      { language: params.language, hasPackage: !!params.packageUrl, timeout: params.timeoutSecs },
      "Executing script in sandbox",
    );

    const response = await fetch(`${this.baseUrl}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: params.script,
        language: params.language,
        output_type: params.outputType ?? "text",
        env: params.env ?? {},
        package_url: params.packageUrl,
        dependencies: params.dependencies ?? [],
        retrieve_files: params.retrieveFiles ?? [],
        timeout_secs: params.timeoutSecs ?? 60,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error({ status: response.status }, "Sandbox execute request failed");
      throw new Error(`Sandbox service error (${response.status}): ${text}`);
    }

    const result = (await response.json()) as SandboxExecuteResult;

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
}
