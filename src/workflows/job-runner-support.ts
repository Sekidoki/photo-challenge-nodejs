import path from "node:path";
import { writeFile } from "node:fs/promises";
import { DateTime } from "luxon";
import type { JobRequest, PublishMode } from "../core/models.js";
import { resolveSubmissionWindow } from "../renderers/voting-page.js";
import { jobStore } from "../infra/job-store.js";
import type { JobOutputPaths } from "../infra/output-paths.js";
import type { CommonsBot, ReadPageResult } from "../services/commons-bot.js";
import type { PublishAuditContext } from "../infra/publish-audit.js";
import { recordPublishAudit } from "../infra/publish-audit.js";
import { recordOperationalEvent } from "../infra/operational-events.js";

export type ProgressStep = {
  percent: number;
  step: string;
  message: string;
};

export type SourcePageSpec = {
  label: string;
  title: string;
  fileName: string;
};

export type ParsedArtifacts = {
  summaryLines: string[];
  files: Array<Record<string, unknown>>;
  votes: Array<Record<string, unknown>>;
  challenges: Array<Record<string, unknown>>;
};

export type WorkflowSummary = {
  sourceCount: number;
  challengeCount: number;
  fileCount: number;
  voteCount: number;
  completionMessage?: string;
};

export type AuthenticatedWorkflowContext = {
  bot: CommonsBot;
  paths: JobOutputPaths;
  jobId: string;
  request: JobRequest;
  challengeSlug: string;
  publishAuditContext: PublishAuditContext;
};

type PublishPageType = "voting" | "result" | "winners";

export function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "challenge";
}

export function updateProgress(jobId: string, step: ProgressStep): void {
  jobStore.markRunning(jobId, step.step, step.percent);
  jobStore.appendMessage(jobId, step.message);
}

export async function readSourcePages(
  bot: CommonsBot,
  paths: JobOutputPaths,
  jobId: string,
  sourcePageSpecs: SourcePageSpec[]
): Promise<ReadPageResult[]> {
  const sourcePages: ReadPageResult[] = [];

  for (let index = 0; index < sourcePageSpecs.length; index += 1) {
    const source = sourcePageSpecs[index];
    const percent = 25 + Math.round((index / Math.max(sourcePageSpecs.length, 1)) * 15);
    updateProgress(jobId, {
      percent,
      step: `Reading ${source.label}`,
      message: `Fetching ${source.title}`
    });

    const page = await bot.readPage(source.title);
    sourcePages.push(page);
    await writeFile(path.join(paths.inputDir, source.fileName), page.content, "utf8");
  }

  return sourcePages;
}

export async function persistCommonArtifacts(
  generatedDir: string,
  challengeSlug: string,
  sources: ReadPageResult[],
  parsed: ParsedArtifacts
): Promise<void> {
  await writeFile(path.join(generatedDir, `${challengeSlug}_summary.txt`), parsed.summaryLines.join("\n"), "utf8");
  await writeFile(
    path.join(generatedDir, `${challengeSlug}_sources.json`),
    JSON.stringify(
      sources.map((source) => ({
        title: source.title,
        revisionTimestamp: source.revisionTimestamp,
        revisionId: source.revisionId,
        contentLength: source.content.length,
        preview: source.content.slice(0, 500)
      })),
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(generatedDir, `${challengeSlug}_challenges.json`), JSON.stringify(parsed.challenges, null, 2), "utf8");
  await writeFile(path.join(generatedDir, `${challengeSlug}_files.json`), JSON.stringify(parsed.files, null, 2), "utf8");
  await writeFile(path.join(generatedDir, `${challengeSlug}_votes.json`), JSON.stringify(parsed.votes, null, 2), "utf8");
}

export async function persistChallengeConfig(generatedDir: string, challengeSlug: string, request: JobRequest): Promise<void> {
  const window = resolveSubmissionWindow(request.challenge, request.submissionWindow);
  await writeFile(
    path.join(generatedDir, `${challengeSlug}_challenge-config.json`),
    JSON.stringify({
      entryMode: request.entryMode ?? "single",
      submissionWindow: {
        startsAt: window.startsAt.toISO(),
        endsAt: window.endsAt.toISO()
      }
    }, null, 2),
    "utf8"
  );
}

export async function finalizeJob(
  logsDir: string,
  jobId: string,
  request: JobRequest,
  currentUser: string | null,
  timestamp: string | null,
  sourceCount: number,
  challengeCount: number,
  fileCount: number,
  voteCount: number
): Promise<void> {
  updateProgress(jobId, {
    percent: 90,
    step: "Writing logs",
    message: "Persisting run metadata to the fixed output directory."
  });

  const timingLines = getJobTimingLogLines(request);
  await writeFile(
    path.join(logsDir, "job.log"),
    [
      `jobId=${jobId}`,
      `status=completed`,
      `action=${request.action}`,
      `challenge=${request.challenge}`,
      `publishMode=${request.publishMode}`,
      ...timingLines,
      `name=${request.credentials.name}`,
      `loggedInAs=${currentUser ?? "unknown"}`,
      `sourceCount=${sourceCount}`,
      `challengeCount=${challengeCount}`,
      `fileCount=${fileCount}`,
      `voteCount=${voteCount}`,
      `completedAt=${timestamp}`
    ].join("\n"),
    "utf8"
  );
}

export async function persistFailedJob(logsDir: string, jobId: string, request: JobRequest, errorMessage: string): Promise<void> {
  const timestamp = DateTime.now().toUTC().toISO();
  const timingLines = getJobTimingLogLines(request);
  await writeFile(
    path.join(logsDir, "job.log"),
    [
      `jobId=${jobId}`,
      `status=failed`,
      `action=${request.action}`,
      `challenge=${request.challenge}`,
      `publishMode=${request.publishMode}`,
      ...timingLines,
      `name=${request.credentials.name}`,
      `errorMessage=${errorMessage.replace(/\r?\n/g, " ")}`,
      `completedAt=${timestamp}`
    ].join("\n"),
    "utf8"
  );
}

function getJobTimingLogLines(request: JobRequest): string[] {
  if (request.action !== "create-voting") {
    return [`entryMode=${request.entryMode ?? "single"}`];
  }

  let window;
  try {
    window = resolveSubmissionWindow(request.challenge, request.submissionWindow);
  } catch {
    return [
      `entryMode=${request.entryMode ?? "single"}`,
      `submissionStart=${request.submissionWindow?.startsAt ?? ""}`,
      `submissionEnd=${request.submissionWindow?.endsAt ?? ""}`
    ];
  }
  return [
    `entryMode=${request.entryMode ?? "single"}`,
    `submissionStart=${window.startsAt.toISO()}`,
    `submissionEnd=${window.endsAt.toISO()}`
  ];
}

export function getSandboxRootForName(loginName: string): string {
  const mainAccount = loginName.trim().split("@")[0]?.trim() ?? "";
  const normalized = mainAccount.replace(/^User:/i, "").replace(/\s+/g, "_");
  return `User:${normalized}/Sandbox`;
}

export function resolvePublishTarget(
  loginName: string,
  challenge: string,
  pageType: PublishPageType,
  publishMode: "sandbox" | "live"
): string {
  if (publishMode === "live") {
    if (pageType === "voting") return `Commons:Photo challenge/${challenge}/Voting`;
    if (pageType === "result") return `Commons:Photo challenge/${challenge}/Voting/Result`;
    return `Commons:Photo challenge/${challenge}/Winners`;
  }

  const sandboxRoot = getSandboxRootForName(loginName);
  if (pageType === "voting") return `${sandboxRoot}/${challenge}/Voting`;
  if (pageType === "result") return `${sandboxRoot}/${challenge}/Voting/Result`;
  return `${sandboxRoot}/${challenge}/Winners`;
}

export async function publishPage(
  bot: CommonsBot,
  jobId: string,
  loginName: string,
  challenge: string,
  pageType: PublishPageType,
  text: string,
  editSummary: string,
  publishMode: PublishMode,
  auditContext: PublishAuditContext
): Promise<void> {
  if (publishMode === "dry-run") return;

  const target = resolvePublishTarget(loginName, challenge, pageType, publishMode);
  jobStore.appendMessage(jobId, `Publishing ${pageType} page to ${target}`);
  let saveResult;
  try {
    saveResult = await bot.savePage(target, text, editSummary);
  } catch (error) {
    await recordPublishAudit({
      ...auditContext,
      event: "publish.failed",
      targetTitle: target,
      revisionId: null,
      result: "failure"
    });
    recordOperationalEvent({
      event: "publish.failure",
      outcome: "failure",
      ...auditContext,
      targetTitle: target,
      failureStage: "save"
    });
    throw error;
  }
  await recordPublishAudit({
    ...auditContext,
    event: "publish.succeeded",
    targetTitle: target,
    revisionId: saveResult.newRevisionId,
    result: saveResult.result
  });
  const revNote = saveResult.newRevisionId ? ` (revision ${saveResult.newRevisionId})` : "";
  jobStore.appendMessage(jobId, `Published ${pageType} page \u2192 ${saveResult.result}${revNote}`);
}

export async function publishRawPage(
  bot: CommonsBot,
  jobId: string,
  label: string,
  targetTitle: string,
  text: string,
  editSummary: string,
  auditContext: PublishAuditContext
): Promise<void> {
  jobStore.appendMessage(jobId, `Publishing ${label} to ${targetTitle}`);
  let saveResult;
  try {
    saveResult = await bot.savePage(targetTitle, text, editSummary);
  } catch (error) {
    await recordPublishAudit({
      ...auditContext,
      event: "publish.failed",
      targetTitle,
      revisionId: null,
      result: "failure"
    });
    recordOperationalEvent({
      event: "publish.failure",
      outcome: "failure",
      ...auditContext,
      targetTitle,
      failureStage: "save"
    });
    throw error;
  }
  await recordPublishAudit({
    ...auditContext,
    event: "publish.succeeded",
    targetTitle,
    revisionId: saveResult.newRevisionId,
    result: saveResult.result
  });
  const revNote = saveResult.newRevisionId ? ` (revision ${saveResult.newRevisionId})` : "";
  jobStore.appendMessage(jobId, `Published ${label} \u2192 ${saveResult.result}${revNote}`);
}
