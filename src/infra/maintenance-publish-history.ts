import path from "node:path";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { getJobOutputPaths } from "./output-paths.js";

export type MaintenancePublishRecord = {
  id: string;
  type: "notifications" | "announcement" | "previous-page" | "file-assessment";
  label: string;
  mode: "sandbox" | "live";
  targetTitle: string;
  liveTargetTitle: string;
  editSummary: string;
  operator: string;
  oauthConsumer: string | null;
  publishedAt: string;
  revisionId: number | null;
  result: string;
};

export async function loadMaintenancePublishHistory(jobId: string): Promise<MaintenancePublishRecord[]> {
  const filePath = path.join(getJobOutputPaths(jobId).generatedDir, "maintenance_publish_history.json");

  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as MaintenancePublishRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function recordMaintenancePublish(jobId: string, record: MaintenancePublishRecord): Promise<void> {
  const paths = getJobOutputPaths(jobId);
  const filePath = path.join(paths.generatedDir, "maintenance_publish_history.json");
  const history = await loadMaintenancePublishHistory(jobId);
  history.unshift(record);
  await writeFile(filePath, JSON.stringify(history, null, 2), "utf8");
  await appendFile(
    path.join(paths.logsDir, "job.log"),
    `maintenancePublish=${record.publishedAt} | ${record.mode} | ${record.type} | ${record.targetTitle} | ${record.revisionId ?? "n/a"}\n`,
    "utf8"
  );
}
