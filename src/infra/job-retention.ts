import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const JOB_RETENTION_DAYS = 30;
export const JOB_CLEANUP_INTERVAL_MS = DAY_MS;

export type JobRetentionResult = {
  removedJobIds: string[];
  failures: Array<{ jobId: string; error: unknown }>;
};

type JobRetentionOptions = {
  outputRoot?: string;
  now?: number;
};

export async function removeExpiredJobs(
  options: JobRetentionOptions = {}
): Promise<JobRetentionResult> {
  const outputRoot = options.outputRoot ?? config.outputRoot;
  const cutoff = (options.now ?? Date.now()) - JOB_RETENTION_DAYS * DAY_MS;
  let entries;

  try {
    entries = await readdir(outputRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { removedJobIds: [], failures: [] };
    }
    throw error;
  }

  const result: JobRetentionResult = { removedJobIds: [], failures: [] };

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const jobPath = path.join(outputRoot, entry.name);
    try {
      const metadata = await stat(jobPath);
      if (metadata.mtimeMs >= cutoff) continue;

      await rm(jobPath, { recursive: true, force: true });
      result.removedJobIds.push(entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        result.failures.push({ jobId: entry.name, error });
      }
    }
  }

  return result;
}

type RetentionLogger = Pick<Console, "info" | "error">;

export async function runJobRetentionCleanup(logger: RetentionLogger = console): Promise<void> {
  try {
    const result = await removeExpiredJobs();
    if (result.removedJobIds.length > 0) {
      logger.info(
        `Removed ${result.removedJobIds.length} job(s) older than ${JOB_RETENTION_DAYS} days: ${result.removedJobIds.join(", ")}`
      );
    }
    for (const failure of result.failures) {
      logger.error(`Failed to remove expired job ${failure.jobId}: ${toErrorMessage(failure.error)}`);
    }
  } catch (error) {
    logger.error(`Failed to inspect expired jobs: ${toErrorMessage(error)}`);
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
