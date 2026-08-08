import { runCli } from "./cli/index.js";
import { runJobRetentionCleanup } from "./infra/job-retention.js";

void runJobRetentionCleanup().then(() => runCli()).then((exitCode) => {
  process.exitCode = exitCode;
});
