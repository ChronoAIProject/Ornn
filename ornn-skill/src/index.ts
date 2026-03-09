/**
 * Entry point for the consolidated ornn-skill service.
 * Handles skill CRUD, search, generation, playground, and admin.
 */

import { loadConfig } from "./infra/config";
import { bootstrap } from "./bootstrap";
import pino from "pino";

const config = loadConfig();

const logger = pino({
  level: config.logLevel,
  ...(config.logPretty ? { transport: { target: "pino-pretty" } } : {}),
}).child({ service: "ornn-skill" });

logger.info({ port: config.port }, "ornn-skill starting");

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
