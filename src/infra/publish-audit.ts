import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import type { JobRequest, PublishMode } from "../core/models.js";
import { config } from "./config.js";
import { getJobOutputPaths } from "./output-paths.js";
import { recordOperationalEvent } from "./operational-events.js";

export type PublishAuditContext = {
  jobId: string;
  workflow: string;
  operator: string;
  oauthConsumer: string | null;
  mode: PublishMode;
};

export type PublishAuditEvent = PublishAuditContext & {
  event: "publish.succeeded" | "publish.failed" | "publish.skipped";
  targetTitle: string;
  revisionId: number | null;
  result: string;
  occurredAt?: string;
};

export function buildJobPublishAuditContext(jobId: string, request: JobRequest): PublishAuditContext {
  return {
    jobId,
    workflow: request.action,
    operator: request.credentials.name,
    oauthConsumer: request.credentials.oauthAccessToken ? config.oauth.clientId : null,
    mode: request.publishMode
  };
}

export async function recordPublishAudit(event: PublishAuditEvent): Promise<void> {
  const record = {
    schemaVersion: 1,
    ...event,
    occurredAt: event.occurredAt ?? new Date().toISOString()
  };

  try {
    const logsDir = getJobOutputPaths(event.jobId).logsDir;
    await mkdir(logsDir, { recursive: true });
    await appendFile(path.join(logsDir, "publish-audit.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    recordOperationalEvent({
      event: "publish.audit.failure",
      outcome: "failure",
      jobId: event.jobId,
      workflow: event.workflow,
      mode: event.mode,
      operator: event.operator,
      oauthConsumer: event.oauthConsumer,
      targetTitle: event.targetTitle,
      failureStage: "audit-write"
    });
  }
}
