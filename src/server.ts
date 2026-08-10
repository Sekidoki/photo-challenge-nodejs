import { createApp } from "./web/app.js";
import { assertWebAuthConfiguration, config } from "./infra/config.js";
import {
  JOB_CLEANUP_INTERVAL_MS,
  runJobRetentionCleanup
} from "./infra/job-retention.js";

async function startServer(): Promise<void> {
  assertWebAuthConfiguration();
  await runJobRetentionCleanup();

  const app = createApp();
  const host = config.webAuthMode === "local" ? "127.0.0.1" : "0.0.0.0";
  app.listen(config.port, host, () => {
    console.log(`Photo Challenge web app listening on ${host}:${config.port} (${config.webAuthMode} authentication)`);
  });

  const cleanupTimer = setInterval(() => {
    void runJobRetentionCleanup();
  }, JOB_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

void startServer();
