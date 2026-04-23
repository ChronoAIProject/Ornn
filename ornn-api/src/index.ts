/**
 * Entry point for the consolidated ornn-api service.
 * Handles skill CRUD, search, generation, playground, and admin.
 */

import { loadConfig, ConfigError, type SkillConfig } from "./infra/config";
import { bootstrap } from "./bootstrap";
import pino from "pino";

let config: SkillConfig;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    // Print every missing/invalid var so operators don't have to retry.
    console.error(`[ornn-api] ${err.message}`);
  } else {
    console.error("[ornn-api] Unexpected error loading config:", err);
  }
  process.exit(1);
}

const logger = pino({
  level: config.logLevel,
  ...(config.logPretty ? { transport: { target: "pino-pretty" } } : {}),
}).child({ service: "ornn-api" });

logger.info({ port: config.port }, "ornn-api starting");

const { app, shutdown } = await bootstrap(config);

// Graceful shutdown with a hard-deadline fallback. K8s sends SIGTERM
// then SIGKILLs after `terminationGracePeriodSeconds` (default 30s). A
// stuck Mongo close can hang the service past that window; the timeout
// here force-exits before K8s notices so pod termination logs stay
// clean and we get a deterministic exit code we can alert on.
const SHUTDOWN_TIMEOUT_MS = 25_000;

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown signal received");
  const timeout = setTimeout(() => {
    logger.fatal({ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  // Allow Node to exit as soon as shutdown resolves, even if the timer is still active.
  timeout.unref();

  try {
    await shutdown();
    clearTimeout(timeout);
    logger.info({ signal }, "Graceful shutdown complete");
    process.exit(0);
  } catch (err) {
    clearTimeout(timeout);
    logger.error({ signal, err }, "Graceful shutdown failed");
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

export default {
  port: config.port,
  fetch: app.fetch,
  idleTimeout: 120,
};
