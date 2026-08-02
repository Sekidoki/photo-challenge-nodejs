export type OperationalEvent = {
  event: "oauth.login.failure" | "oauth.refresh.failure" | "publish.failure" | "publish.audit.failure" | "job.duration";
  outcome: "success" | "failure";
  jobId?: string;
  workflow?: string;
  mode?: string;
  operator?: string;
  oauthConsumer?: string | null;
  targetTitle?: string;
  durationMs?: number;
  failureStage?: "callback" | "refresh" | "authentication" | "save" | "audit-write";
};

export function recordOperationalEvent(event: OperationalEvent): void {
  const record = {
    schemaVersion: 1,
    source: "photo-challenge-nodejs",
    occurredAt: new Date().toISOString(),
    ...event
  };
  const serialized = JSON.stringify(record);

  if (event.outcome === "failure") {
    console.error(serialized);
    return;
  }

  console.info(serialized);
}
