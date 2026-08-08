import path from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { isVoteCountingAction } from "../core/job-actions.js";
import type { EntryMode, JobRequest } from "../core/models.js";
import type { ScoredVotingFile } from "../core/scoring.js";
import { config } from "../infra/config.js";
import type { JobOutputPaths } from "../infra/output-paths.js";
import type { CommonsBot, ReadPageResult } from "../services/commons-bot.js";
import { buildMaintenancePublishEntries, type MaintenancePublishMode } from "./maintenance-publish.js";
import { publishMaintenanceEditPlans } from "./publish-service.js";
import type { PublishAuditContext } from "../infra/publish-audit.js";
import {
  buildChallengeAnnouncement,
  buildFileAssessmentPlans,
  buildPreviousPageUpdate,
  buildWinnerNotifications,
  type ChallengeAnnouncementInput
} from "./post-results-maintenance.js";

export type PostResultsMaintenanceSummary = {
  sourceCount: number;
  challengeCount: number;
  fileCount: number;
  voteCount: number;
};

type MaintenanceSource = {
  challenge: string;
  jobId: string;
  files: ScoredVotingFile[];
  rawContent: string;
};

type ProgressReporter = (percent: number, step: string, message: string) => void;
type MessageReporter = (message: string) => void;
type PublishRuntime = {
  bot: CommonsBot;
  jobId: string;
  loginName: string;
  publishAuditContext?: PublishAuditContext;
};

export async function runPostResultsMaintenance(
  paths: JobOutputPaths,
  request: JobRequest,
  reportProgress: ProgressReporter,
  reportMessage: MessageReporter,
  publishRuntime: PublishRuntime | null = null
): Promise<PostResultsMaintenanceSummary> {
  const challenges = [request.challenge, request.pairedChallenge].filter((value): value is string => Boolean(value?.trim()));
  if (challenges.length === 0) {
    throw new Error("post-results-maintenance requires at least one challenge.");
  }

  reportProgress(18, "Loading scored results", "Looking up the latest vote-counting outputs from output/jobs.");

  const sources: MaintenanceSource[] = [];
  for (let index = 0; index < challenges.length; index += 1) {
    const challenge = challenges[index];
    const source = await loadLatestScoredFiles(challenge, publishRuntime?.bot ?? null);
    sources.push(source);
    await writeFile(path.join(paths.inputDir, `${slugify(challenge)}_source_files.json`), source.rawContent, "utf8");
    reportMessage(`Loaded scored files for ${challenge} from ${source.jobId}.`);
    reportProgress(18 + Math.round(((index + 1) / challenges.length) * 24), "Loading scored results", `Resolved latest files for ${challenge}`);
  }

  const challengeInputs: ChallengeAnnouncementInput[] = sources.map((source) => ({
    challenge: source.challenge,
    files: source.files
  }));

  reportProgress(50, "Building maintenance plans", "Generating winner talk-page notifications and follow-up maintenance edits.");

  const notifications = buildWinnerNotifications(request.challenge, sources[0].files);
  const assessmentPlans = buildFileAssessmentPlans(challengeInputs);
  const shouldBuildAnnouncement = await shouldBuildChallengeAnnouncement(
    challenges,
    publishRuntime?.bot ?? null,
    reportMessage
  );
  const challengeAnnouncement = shouldBuildAnnouncement ? buildChallengeAnnouncement(challengeInputs) : null;
  const previousPageUpdate = challengeInputs.length === 2 ? buildPreviousPageUpdate(challenges) : null;

  reportProgress(78, "Writing plan artifacts", "Saving dry-run maintenance plans to the job output folder.");

  const primarySlug = slugify(request.challenge);
  await writeFile(path.join(paths.generatedDir, `${primarySlug}_winner_notifications.json`), JSON.stringify(notifications, null, 2), "utf8");
  await writeFile(path.join(paths.generatedDir, `${primarySlug}_winner_notifications.txt`), renderWinnerNotificationsText(notifications), "utf8");
  await writeFile(path.join(paths.generatedDir, `${primarySlug}_file_assessments.json`), JSON.stringify(assessmentPlans, null, 2), "utf8");

  if (challengeAnnouncement) {
    await writeFile(path.join(paths.generatedDir, `${primarySlug}_challenge_announcement.txt`), renderSectionPlan(challengeAnnouncement.targetTitle, challengeAnnouncement.sectionHeading, challengeAnnouncement.bodyText), "utf8");
  }

  if (previousPageUpdate) {
    await writeFile(path.join(paths.generatedDir, `${primarySlug}_previous_page_update.txt`), previousPageUpdate.prependText, "utf8");
  }

  const maintenancePlan = {
    mode: request.publishMode,
    primaryChallenge: request.challenge,
    pairedChallenge: request.pairedChallenge ?? null,
    sourceJobs: sources.map((source) => ({ challenge: source.challenge, jobId: source.jobId, fileCount: source.files.length })),
    notifications,
    challengeAnnouncement,
    previousPageUpdate,
    assessmentPlans
  };
  const maintenancePlanContent = JSON.stringify(maintenancePlan, null, 2);
  await writeFile(path.join(paths.generatedDir, `${primarySlug}_maintenance_plan.json`), maintenancePlanContent, "utf8");

  let automaticPublish = {
    notifications: 0,
    fileAssessments: 0,
    announcements: 0,
    previousPages: 0
  };
  if (request.publishMode !== "dry-run") {
    if (!publishRuntime) {
      throw new Error("post-results-maintenance publish mode requires an authenticated runtime bot.");
    }

    reportProgress(86, "Publishing maintenance outputs", `Writing planned maintenance edits to ${request.publishMode}.`);
    automaticPublish = await publishMaintenancePlanEntries(
      maintenancePlanContent,
      request.publishMode,
      publishRuntime,
      reportMessage
    );
  }

  const summaryLines = [
    `Action: ${request.action}`,
    `Primary challenge: ${request.challenge}`,
    `Paired challenge: ${request.pairedChallenge ?? "(none)"}`,
    `Publish mode: ${request.publishMode}`,
    "",
    `Resolved source jobs: ${sources.map((source) => `${source.challenge} -> ${source.jobId}`).join("; ")}`,
    `Winner notifications: ${notifications.length}${request.publishMode === "dry-run" ? " (planned only)" : ` (${automaticPublish.notifications} published to ${request.publishMode})`}`,
    `File assessments: ${assessmentPlans.length}${request.publishMode === "dry-run" ? " (planned only)" : ` (${automaticPublish.fileAssessments} published to ${request.publishMode})`}`,
    `Challenge announcement: ${challengeAnnouncement ? (request.publishMode === "dry-run" ? "planned only" : `${automaticPublish.announcements} published to ${request.publishMode}`) : "skipped (requires exactly two challenges)"}`,
    `Previous page update: ${previousPageUpdate ? (request.publishMode === "dry-run" ? "planned only" : `${automaticPublish.previousPages} published to ${request.publishMode}`) : "skipped (requires exactly two challenges)"}`
  ];
  await writeFile(path.join(paths.generatedDir, `${primarySlug}_summary.txt`), summaryLines.join("\n"), "utf8");

  reportMessage(`Planned ${notifications.length} winner notification(s), ${assessmentPlans.length} file assessment edit(s), and ${challengeAnnouncement ? 1 : 0} central announcement(s).`);
  if (request.publishMode !== "dry-run") {
    reportMessage(`Published ${automaticPublish.notifications} winner notification target(s), ${automaticPublish.fileAssessments} file assessment edit(s), ${automaticPublish.announcements} central announcement(s), and ${automaticPublish.previousPages} Previous-page update(s) to ${request.publishMode}.`);
  }

  return {
    sourceCount: sources.length,
    challengeCount: challenges.length,
    fileCount: sources.reduce((sum, source) => sum + source.files.length, 0),
    voteCount: 0
  };
}

async function shouldBuildChallengeAnnouncement(
  challenges: string[],
  bot: CommonsBot | null,
  reportMessage: MessageReporter
): Promise<boolean> {
  if (challenges.length !== 2) {
    return false;
  }

  if (!bot) {
    return true;
  }

  const missingPages: string[] = [];
  for (const challenge of challenges) {
    const pageTitle = `Commons:Photo challenge/${challenge}/Winners`;
    try {
      await bot.readPage(pageTitle);
    } catch {
      missingPages.push(pageTitle);
    }
  }

  if (missingPages.length > 0) {
    reportMessage(`Skipping central announcement because winner page(s) are not published yet: ${missingPages.join(", ")}.`);
    return false;
  }

  return true;
}

async function loadLatestScoredFiles(challenge: string, bot: CommonsBot | null): Promise<MaintenanceSource> {
  const localSource = await loadLatestLocalScoredFiles(challenge);
  if (localSource) {
    return localSource;
  }

  if (bot) {
    return loadPublishedWinnerFiles(challenge, bot);
  }

  throw new Error(`No completed count-votes-and-select-winners outputs were found for ${challenge}. Run count-votes-and-select-winners first, or run post-results-maintenance in sandbox/live mode after the Winners page has been published.`);
}

async function loadLatestLocalScoredFiles(challenge: string): Promise<MaintenanceSource | null> {
  const entries = await readdir(config.outputRoot, { withFileTypes: true });
  const candidates: Array<{ jobId: string; completedAt: string; filePath: string }> = [];
  const challengeSlug = slugify(challenge);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const jobId = entry.name;
    const logPath = path.join(config.outputRoot, jobId, "logs", "job.log");
    let logContent: string;
    try {
      logContent = await readFile(logPath, "utf8");
    } catch {
      continue;
    }

    const values = parseLogFile(logContent);
    if (values.status !== "completed") continue;
    if (!isVoteCountingAction(values.action)) continue;
    if (values.challenge !== challenge) continue;

    const filePath = path.join(config.outputRoot, jobId, "generated", `${challengeSlug}_files.json`);
    try {
      await readFile(filePath, "utf8");
    } catch {
      continue;
    }

    candidates.push({
      jobId,
      completedAt: values.completedAt ?? "",
      filePath
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
  const selected = candidates[0];
  const rawContent = await readFile(selected.filePath, "utf8");
  const parsed = JSON.parse(rawContent) as ScoredVotingFile[];

  return {
    challenge,
    jobId: `job ${selected.jobId}`,
    files: parsed,
    rawContent
  };
}

async function loadPublishedWinnerFiles(challenge: string, bot: CommonsBot): Promise<MaintenanceSource> {
  const pageTitle = `Commons:Photo challenge/${challenge}/Winners`;
  const page = await bot.readPage(pageTitle);
  const files = parsePublishedWinnersPage(page);

  if (files.length === 0) {
    if (looksLikeDuoWinnersPage(page.content)) {
      throw new Error(`Duo winners page ${pageTitle} cannot be used as a maintenance source yet. Run count-votes-and-select-winners for ${challenge} first so post-results-maintenance can use the local scored artifact with entry member data.`);
    }
    throw new Error(`No local count-votes-and-select-winners outputs were found for ${challenge}, and ${pageTitle} does not contain parseable winner data.`);
  }

  return {
    challenge,
    jobId: `published page ${page.title}`,
    files,
    rawContent: JSON.stringify(files, null, 2)
  };
}

function looksLikeDuoWinnersPage(content: string): boolean {
  return /\{\|\s*class\s*=\s*"wikitable"/i.test(content)
    && !/\{\{\s*Photo challenge winners table\b/i.test(content)
    && /\[\[File:[^\]]+\|x240px\]\]/i.test(content);
}

export function parsePublishedWinnersPage(page: ReadPageResult): ScoredVotingFile[] {
  const values = parseTemplateParameters(page.content);
  const files: ScoredVotingFile[] = [];
  const mode = parseWinnerEntryMode(values.get("entry_mode"));

  for (let index = 1; index <= 3; index += 1) {
    const fileName = values.get(`image_${index}`);
    const creator = values.get(`author_${index}`);
    if (!fileName || !creator) continue;

    const title = normalizeWinnerTitle(values.get(`title_${index}`) ?? fileName);
    const members: NonNullable<ScoredVotingFile["members"]> = [{
      role: "submission",
      fileName,
      title,
      creator
    }];

    if (mode === "duo-coequal") {
      const secondFileName = values.get(`image_${index}_2`);
      if (secondFileName) {
        members.push({
          role: "submission",
          fileName: secondFileName,
          title: normalizeWinnerTitle(values.get(`title_${index}_2`) ?? secondFileName),
          creator
        });
      }
    } else if (mode === "duo-reference") {
      const referenceFileName = values.get(`reference_image_${index}`);
      if (referenceFileName) {
        members.unshift({
          role: "reference",
          fileName: referenceFileName,
          title: normalizeWinnerTitle(values.get(`reference_title_${index}`) ?? referenceFileName),
          creator: ""
        });
      }
    }

    files.push({
      num: Number.parseInt(values.get(`num_${index}`) ?? `${index}`, 10),
      fileName,
      title,
      creator,
      score: Number.parseInt(values.get(`score_${index}`) ?? "0", 10),
      support: 0,
      rank: Number.parseInt(values.get(`rank_${index}`) ?? `${index}`, 10),
      mode,
      members
    });
  }

  return files;
}

function parseWinnerEntryMode(value: string | undefined): EntryMode {
  if (value === "duo-coequal" || value === "duo-reference") {
    return value;
  }
  return "single";
}

function parseTemplateParameters(content: string): Map<string, string> {
  const values = new Map<string, string>();
  const matches = content.matchAll(/^\|\s*([^=\n]+?)\s*=\s*(.*?)\s*$/gm);

  for (const match of matches) {
    values.set(match[1].trim(), match[2].trim());
  }

  return values;
}

function normalizeWinnerTitle(title: string): string {
  return title.replace(/\s*<br\s*\/?>\s*/gi, " ").replace(/\s+/g, " ").trim();
}

function parseLogFile(content: string): Record<string, string> {
  const pairs = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      return separator < 0 ? null : [line.slice(0, separator), line.slice(separator + 1)] as const;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null);

  return Object.fromEntries(pairs);
}

function renderWinnerNotificationsText(notifications: Array<{ targetTitle: string; sectionHeading: string; bodyText: string }>): string {
  return notifications
    .map((notification) => [
      `Target: ${notification.targetTitle}`,
      `Heading: ${notification.sectionHeading}`,
      notification.bodyText,
      ""
    ].join("\n"))
    .join("\n");
}

function renderSectionPlan(targetTitle: string, sectionHeading: string, bodyText: string): string {
  return [
    `Target: ${targetTitle}`,
    `Heading: ${sectionHeading}`,
    "",
    bodyText,
    ""
  ].join("\n");
}

function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "challenge";
}

async function publishMaintenancePlanEntries(
  maintenancePlanContent: string,
  mode: MaintenancePublishMode,
  runtime: PublishRuntime,
  reportMessage: MessageReporter
): Promise<{ notifications: number; fileAssessments: number; announcements: number; previousPages: number }> {
  const entries = buildMaintenancePublishEntries(maintenancePlanContent, runtime.loginName, mode);
  return publishMaintenanceEditPlans(runtime.bot, runtime.jobId, entries, mode, reportMessage, runtime.publishAuditContext ?? {
    jobId: runtime.jobId,
    workflow: "post-results-maintenance",
    operator: runtime.loginName,
    oauthConsumer: null,
    mode
  });
}
