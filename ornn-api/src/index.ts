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

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM");
  await shutdown();
  process.exit(0);
});
process.on("SIGINT", async () => {
  logger.info("Received SIGINT");
  await shutdown();
  process.exit(0);
});

export default {
  port: config.port,
  fetch: app.fetch,
  idleTimeout: 120,
};
