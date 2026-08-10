import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { JobProgress, PublishMode } from "../core/models.js";
import { config } from "./config.js";
import { getJobOutputPaths } from "./output-paths.js";

function parseLogFile(content: string): Record<string, string> {
  const entries = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      if (separator < 0) {
        return null;
      }

      return [line.slice(0, separator), line.slice(separator + 1)] as const;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null);

  return Object.fromEntries(entries);
}

function toPersistedJob(jobId: string, logValues: Record<string, string>): JobProgress {
  const paths = getJobOutputPaths(jobId);
  const finishedAtValue = logValues.completedAt ? new Date(logValues.completedAt) : null;
  const finishedAt = finishedAtValue && !Number.isNaN(finishedAtValue.getTime()) ? finishedAtValue : null;
  const status = (logValues.status as JobProgress["status"]) ?? "completed";

  const rawPublishMode = logValues.publishMode;
  const publishMode: PublishMode =
    rawPublishMode === "sandbox" || rawPublishMode === "live" ? rawPublishMode : "dry-run";

  return {
    id: jobId,
    status,
    currentStep: status === "failed" ? "Failed" : status === "completed" ? "Completed" : status,
    percent: status === "completed" ? 100 : 0,
    startedAt: finishedAt,
    finishedAt,
    messages: [
      "Recovered from persisted job history.",
      `Artifacts available in ${paths.jobRoot}`,
      ...(logValues.loggedInAs ? [`Last successful login: ${logValues.loggedInAs}`] : []),
      ...(logValues.errorMessage ? [`Last error: ${logValues.errorMessage}`] : [])
    ],
    outputDir: paths.jobRoot,
    action: logValues.action ?? "unknown",
    challenge: logValues.challenge ?? "Unknown challenge",
    publishMode,
    loginName: logValues.name ?? "",
    errorMessage: logValues.errorMessage ?? null
  };
}

export async function loadPersistedJob(jobId: string): Promise<JobProgress | null> {
  const logPath = path.join(getJobOutputPaths(jobId).logsDir, "job.log");

  try {
    const content = await readFile(logPath, "utf8");
    const values = parseLogFile(content);
    return toPersistedJob(jobId, values);
  } catch {
    return null;
  }
}

export async function listPersistedJobs(
  limit = 3,
  filter: (job: JobProgress) => boolean = () => true
): Promise<JobProgress[]> {
  let entries: string[] = [];

  try {
    entries = await readdir(config.outputRoot);
  } catch {
    return [];
  }

  const jobs = await Promise.all(entries.map((entry) => loadPersistedJob(entry)));
  return jobs
    .filter((job): job is JobProgress => job !== null)
    .filter(filter)
    .sort((left, right) => (right.finishedAt?.getTime() ?? 0) - (left.finishedAt?.getTime() ?? 0))
    .slice(0, limit);
}
