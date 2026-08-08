import { createApp } from "./web/app.js";
import { config } from "./infra/config.js";
import {
  JOB_CLEANUP_INTERVAL_MS,
  runJobRetentionCleanup
} from "./infra/job-retention.js";

async function startServer(): Promise<void> {
  await runJobRetentionCleanup();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Photo Challenge web app listening on http://localhost:${config.port}`);
  });

  const cleanupTimer = setInterval(() => {
    void runJobRetentionCleanup();
  }, JOB_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

void startServer();
