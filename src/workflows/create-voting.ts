import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { JobRequest, VotingEntry, VotingEntryMember } from "../core/models.js";
import { assembleVotingEntries } from "../core/submission-entries.js";
import {
  extractPrefixIndexPrefix,
  parseSubmittedChallenges,
  parseSubmissionPage
} from "../parsers/submitting-parser.js";
import { renderVotingPage, resolveSubmissionWindow } from "../renderers/voting-page.js";
import { jobStore } from "../infra/job-store.js";
import type { CommonsBot, FileInfoLookup, ReadPageResult } from "../services/commons-bot.js";
import type {
  AuthenticatedWorkflowContext,
  ParsedArtifacts,
  SourcePageSpec,
  WorkflowSummary
} from "./job-runner-support.js";
import {
  persistChallengeConfig,
  persistCommonArtifacts,
  markSandboxPagesForDeletion,
  publishPage,
  readSourcePages,
  resolvePublishTarget,
  updateProgress
} from "./job-runner-support.js";

const sourcePageSpecs: SourcePageSpec[] = [
  { label: "submission page", title: "", fileName: "submission-page.txt" },
  { label: "submitting index", title: "Commons:Photo challenge/Submitting", fileName: "submitting-index.txt" }
];

export async function runCreateVotingWorkflow({
  bot,
  paths,
  jobId,
  request,
  challengeSlug,
  publishAuditContext
}: AuthenticatedWorkflowContext): Promise<WorkflowSummary> {
  const sourcePages = await readSourcePages(
    bot,
    paths,
    jobId,
    sourcePageSpecs.map((source) => source.title
      ? source
      : { ...source, title: `Commons:Photo challenge/${request.challenge}` })
  );

  await enrichCreateVotingSources(bot, request, sourcePages, paths.inputDir, jobId);
  const submissionAssembly = await handleCreateVoting(bot, request, sourcePages, jobId);
  const parsedArtifacts = parseCreateVotingArtifacts(request, sourcePages, submissionAssembly.entries);
  await persistCommonArtifacts(paths.generatedDir, challengeSlug, sourcePages, parsedArtifacts);
  await persistChallengeConfig(paths.generatedDir, challengeSlug, request);

  const renderedVotingPage = renderVotingPage(request.challenge, submissionAssembly.entries, {
    submissionWindow: request.submissionWindow,
    issues: submissionAssembly.issues
  });
  await writeFile(path.join(paths.generatedDir, `${challengeSlug}_voting.txt`), renderedVotingPage.text, "utf8");
  jobStore.appendMessage(jobId, `Rendered voting page with ${renderedVotingPage.includedCount} entries and ${renderedVotingPage.issueCount} issues.`);

  updateProgress(jobId, { percent: 88, step: "Publishing pages", message: `Publish mode: ${request.publishMode}` });
  await publishPage(
    bot,
    jobId,
    request.credentials.name,
    request.challenge,
    "voting",
    renderedVotingPage.text,
    "Photo Challenge bot: create voting page",
    request.publishMode,
    publishAuditContext
  );
  if (request.publishMode === "live") {
    await markSandboxPagesForDeletion(
      bot,
      [{
        label: "voting page",
        targetTitle: resolvePublishTarget(request.credentials.name, request.challenge, "voting", "sandbox")
      }],
      (message) => jobStore.appendMessage(jobId, message),
      publishAuditContext
    );
  }

  return {
    sourceCount: sourcePages.length,
    challengeCount: parsedArtifacts.challenges.length,
    fileCount: parsedArtifacts.files.length,
    voteCount: parsedArtifacts.votes.length
  };
}

async function handleCreateVoting(
  bot: CommonsBot,
  request: JobRequest,
  sourcePages: ReadPageResult[],
  jobId: string
): Promise<{ entries: VotingEntry[]; issues: string[] }> {
  updateProgress(jobId, {
    percent: 50,
    step: "Loading file metadata",
    message: "Looking up uploader, timestamp, dimensions, and own-work markers for submission files."
  });

  const submissionEntries = await loadSubmissionEntries(bot, request, sourcePages, jobId);

  updateProgress(jobId, {
    percent: 65,
    step: "Parsing source content",
    message: "Running the first TypeScript parsers on live Commons content."
  });

  return submissionEntries;
}

async function enrichCreateVotingSources(bot: CommonsBot, request: JobRequest, sourcePages: ReadPageResult[], inputDir: string, jobId: string): Promise<void> {
  const submissionPage = sourcePages.find((source) => source.title === `Commons:Photo challenge/${request.challenge}`);
  if (!submissionPage) return;

  const inlineFiles = parseSubmissionPage(submissionPage.content);
  if (inlineFiles.length > 0) {
    jobStore.appendMessage(jobId, `Found ${inlineFiles.length} inline gallery files on the main challenge page.`);
    return;
  }

  const prefix = extractPrefixIndexPrefix(submissionPage.content);
  if (!prefix) {
    jobStore.appendMessage(jobId, "No inline gallery or PrefixIndex template found on the submission page.");
    return;
  }

  const normalizedPrefix = prefix.replace(/^Commons:/i, "");
  updateProgress(jobId, { percent: 45, step: "Discovering submission subpages", message: `Listing subpages under Commons:${normalizedPrefix}` });
  const titles = await bot.listPagesByPrefix(normalizedPrefix, 4);
  const filteredTitles = titles.filter((title) => title !== submissionPage.title);
  jobStore.appendMessage(jobId, `Discovered ${filteredTitles.length} submission subpages from PrefixIndex.`);

  for (let index = 0; index < filteredTitles.length; index += 1) {
    const title = filteredTitles[index];
    const page = await bot.readPage(title);
    sourcePages.push(page);
    await writeFile(path.join(inputDir, `subpage-${String(index + 1).padStart(2, "0")}.txt`), page.content, "utf8");
  }
}

async function loadSubmissionEntries(
  bot: CommonsBot,
  request: JobRequest,
  sourcePages: ReadPageResult[],
  jobId: string
): Promise<{ entries: VotingEntry[]; issues: string[] }> {
  const submissionSources = sourcePages.filter((source) => source.title.startsWith(`Commons:Photo challenge/${request.challenge}`));
  const assembly = assembleVotingEntries(
    submissionSources.flatMap((source) => parseSubmissionPage(source.content)),
    request.entryMode ?? "single"
  );
  const fileNames = assembly.entries.flatMap((entry) => entry.members)
    .filter((member) => member.displayKind === "commons-file" && member.fileName)
    .map((member) => member.fileName as string);
  if (assembly.entries.length === 0) return assembly;

  const infoByName = new Map<string, FileInfoLookup>((await bot.listFileInfo(fileNames)).map((info) => [info.fileName, info]));
  const enrichedEntries = assembly.entries.map((entry) => ({
    ...entry,
    members: entry.members.map((member) => enrichSubmissionMember(member, infoByName))
  }));
  const counters = new Map<string, number>();
  for (const entry of enrichedEntries) {
    const userKey = entry.members.find((member) => member.role === "submission")?.user ?? "";
    const seenCount = counters.get(userKey) ?? 0;
    const active = Boolean(userKey) && seenCount < 4;
    counters.set(userKey, seenCount + 1);
    for (const member of entry.members.filter((member) => member.role === "submission")) {
      member.active = active;
    }
  }

  const members = enrichedEntries.flatMap((entry) => entry.members);
  const missingCount = members.filter((member) => !member.exists).length;
  const inactiveCount = enrichedEntries.filter((entry) => entry.members.some((member) => member.role === "submission" && !member.active)).length;
  const nonOwnWorkCount = members.filter((member) => member.role === "submission" && member.exists && !member.ownWork).length;
  jobStore.appendMessage(jobId, `Loaded metadata for ${enrichedEntries.length} entries (${members.length} members, ${missingCount} missing, ${inactiveCount} over-limit entries, ${nonOwnWorkCount} submissions not marked own-work).`);
  return { entries: enrichedEntries, issues: assembly.issues };
}

function enrichSubmissionMember(member: VotingEntryMember, infoByName: Map<string, FileInfoLookup>): VotingEntryMember {
  if (member.displayKind === "placeholder") {
    return { ...member, exists: true, active: true };
  }
  const info = member.fileName ? infoByName.get(member.fileName) : undefined;
  return {
    ...member,
    user: info?.user ?? null,
    uploaded: info?.uploaded ?? null,
    width: info?.width ?? null,
    height: info?.height ?? null,
    comment: info?.comment ?? null,
    ownWork: info?.ownWork ?? false,
    exists: info?.exists ?? false
  };
}

function parseCreateVotingArtifacts(request: JobRequest, sourcePages: ReadPageResult[], entries: VotingEntry[]): ParsedArtifacts {
  const submissionPage = sourcePages.find((source) => source.title === `Commons:Photo challenge/${request.challenge}`);
  const submittingIndex = sourcePages.find((source) => source.title === "Commons:Photo challenge/Submitting");
  const challenges = submittingIndex ? parseSubmittedChallenges(submittingIndex.content) : [];
  const submissionSources = sourcePages.filter((source) => source.title.startsWith(`Commons:Photo challenge/${request.challenge}`));
  const members = entries.flatMap((entry) => entry.members);
  const window = resolveSubmissionWindow(request.challenge, request.submissionWindow);

  return {
    summaryLines: [
      `Action: ${request.action}`,
      `Challenge: ${request.challenge}`,
      `Configured login name: ${request.credentials.name}`,
      `Entry mode: ${request.entryMode ?? "single"}`,
      `Submission start: ${window.startsAt.toISO()}`,
      `Submission end: ${window.endsAt.toISO()}`,
      "",
      `Submitting index challenges found: ${challenges.length}`,
      `Submission sources crawled: ${submissionSources.length}`,
      `Submission entries assembled: ${entries.length}`,
      `Submission gallery members found: ${members.length}`,
      `Uses PrefixIndex: ${submissionPage ? String(Boolean(extractPrefixIndexPrefix(submissionPage.content))) : "false"}`,
      `Missing files: ${members.filter((member) => !member.exists).length}`,
      `Over-limit entries: ${entries.filter((entry) => entry.members.some((member) => member.role === "submission" && !member.active)).length}`,
      `Submission files not marked own-work: ${members.filter((member) => member.role === "submission" && member.exists && !member.ownWork).length}`,
      "",
      "Recent challenges from Submitting index:",
      ...challenges.slice(0, 10).map((challenge) => `- ${challenge.raw}`),
      "",
      "First enriched submission entries:",
      ...entries.slice(0, 10).map((entry) => `- ${entry.mode} :: ${entry.members.map((member) => `${member.role}:${member.fileName ?? "empty"}:${member.user ?? "unknown"}`).join(" || ")}`)
    ],
    challenges,
    files: entries,
    votes: []
  };
}
