import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { JobRequest, VotingEntry } from "../core/models.js";
import { formatVoteDeadlineUtc, getVoteDeadlineUtc, getVoteDeadlineZoneLabel } from "../core/challenge-date.js";
import { countVotes, type ScoredVotingFile } from "../core/scoring.js";
import { listErrors, validateVotes, type VoteWithError, type VoterValidation } from "../core/validation.js";
import { validateVoters } from "../core/voters.js";
import { parseSubmissionPage } from "../parsers/submitting-parser.js";
import { parseVotingChallenges, parseVotingPage } from "../parsers/voting-parser.js";
import { renderResultPage } from "../renderers/result-page.js";
import { reviseVotingPage } from "../renderers/revised-voting-page.js";
import { renderWinnersPage } from "../renderers/winners-page.js";
import { jobStore } from "../infra/job-store.js";
import type { CommonsBot, ReadPageResult } from "../services/commons-bot.js";
import type {
  AuthenticatedWorkflowContext,
  ParsedArtifacts,
  SourcePageSpec,
  WorkflowSummary
} from "./job-runner-support.js";
import {
  persistCommonArtifacts,
  publishPage,
  readSourcePages,
  updateProgress
} from "./job-runner-support.js";

function getSourcePageSpecs(request: JobRequest): SourcePageSpec[] {
  return [
    { label: "submission page", title: `Commons:Photo challenge/${request.challenge}`, fileName: "submission-page.txt" },
    { label: "voting page", title: `Commons:Photo challenge/${request.challenge}/Voting`, fileName: "voting-page.txt" },
    { label: "voting index", title: "Commons:Photo challenge/Voting", fileName: "voting-index.txt" }
  ];
}

export async function runVoteCountingWorkflow({
  bot,
  paths,
  jobId,
  request,
  challengeSlug,
  publishAuditContext
}: AuthenticatedWorkflowContext): Promise<WorkflowSummary> {
  const sourcePages = await readSourcePages(bot, paths, jobId, getSourcePageSpecs(request));
  const artifacts = await buildVoteCountingArtifacts(bot, request, sourcePages, jobId);
  await persistCommonArtifacts(paths.generatedDir, challengeSlug, sourcePages, artifacts.parsed);
  await writeFile(path.join(paths.generatedDir, `${challengeSlug}_revised.txt`), artifacts.revisedText, "utf8");
  await writeFile(path.join(paths.generatedDir, `${challengeSlug}_result.txt`), artifacts.resultText, "utf8");
  await writeFile(path.join(paths.generatedDir, `${challengeSlug}_winners.txt`), artifacts.winnersText, "utf8");

  updateProgress(jobId, { percent: 88, step: "Publishing pages", message: `Publish mode: ${request.publishMode}` });
  await publishPage(bot, jobId, request.credentials.name, request.challenge, "voting", artifacts.revisedText, "Photo Challenge bot: revise voting page after validation", request.publishMode, publishAuditContext);
  await publishPage(bot, jobId, request.credentials.name, request.challenge, "result", artifacts.resultText, "Photo Challenge bot: create result page", request.publishMode, publishAuditContext);
  await publishPage(bot, jobId, request.credentials.name, request.challenge, "winners", artifacts.winnersText, "Photo Challenge bot: create winners page", request.publishMode, publishAuditContext);

  return {
    sourceCount: sourcePages.length,
    challengeCount: artifacts.parsed.challenges.length,
    fileCount: artifacts.parsed.files.length,
    voteCount: artifacts.parsed.votes.length
  };
}

async function buildVoteCountingArtifacts(
  bot: CommonsBot,
  request: JobRequest,
  sourcePages: ReadPageResult[],
  jobId: string
): Promise<{
  parsed: ParsedArtifacts;
  revisedText: string;
  resultText: string;
  winnersText: string;
}> {
  const votingPage = sourcePages.find((source) => source.title === `Commons:Photo challenge/${request.challenge}/Voting`);
  const votingIndex = sourcePages.find((source) => source.title === "Commons:Photo challenge/Voting");
  const parsedVoting = votingPage
    ? parseVotingPage(votingPage.content)
    : { entryMode: "single" as const, entries: [], files: [], votes: [], issues: [] };
  const challenges = votingIndex ? parseVotingChallenges(votingIndex.content) : [];
  const entrantNames = await loadSubmissionEntrantNames(bot, request, sourcePages);

  updateProgress(jobId, {
    percent: 50,
    step: "Validating voters",
    message: "Checking voter eligibility and challenge participation rules."
  });
  const voters = await validateVoters(bot, parsedVoting.votes, request.challenge, entrantNames);

  updateProgress(jobId, {
    percent: 62,
    step: "Validating votes",
    message: "Applying duplicate, self-vote, award-tier, and deadline validation rules."
  });
  const votes = validateVotes(parsedVoting.votes, voters, request.challenge);

  updateProgress(jobId, {
    percent: 72,
    step: "Scoring results",
    message: "Calculating score, support, and rank for each file."
  });
  const scoredFiles = countVotes(parsedVoting.entries, votes);
  const errors = listErrors(votes, voters, request.challenge);

  updateProgress(jobId, {
    percent: 82,
    step: "Rendering outputs",
    message: "Rendering revised voting page, result page, and winners page."
  });

  const revisedText = votingPage ? reviseVotingPage(votingPage.content) : "";
  const resultText = renderResultPage(scoredFiles, new Set(parsedVoting.votes.map((vote) => vote.voter).filter(Boolean)).size, errors);
  const winnersText = renderWinnersPage(scoredFiles, request.challenge);

  const parsed = parseVoteCountingArtifacts(request, challenges, parsedVoting.entries, votes, voters, scoredFiles);
  const lateVotes = votes.filter((vote) => vote.error === 9).length;
  if (lateVotes > 0) {
    jobStore.appendMessage(jobId, `Detected ${lateVotes} late vote(s) after the deadline of ${formatVoteDeadlineUtc(request.challenge)} ${getVoteDeadlineZoneLabel()}.`);
  }
  return { parsed, revisedText, resultText, winnersText };
}

async function loadSubmissionEntrantNames(
  bot: CommonsBot,
  request: JobRequest,
  sourcePages: ReadPageResult[]
): Promise<string[]> {
  const submissionSources = sourcePages.filter((source) => source.title === `Commons:Photo challenge/${request.challenge}`);
  const submissionFiles = submissionSources.flatMap((source) => parseSubmissionPage(source.content));
  const fileNames = [...new Set(submissionFiles.map((file) => file.fileName).filter(Boolean))];
  if (fileNames.length === 0) {
    return [];
  }

  const fileInfo = await bot.listFileInfo(fileNames);
  return [...new Set(fileInfo.map((info) => info.user).filter((user): user is string => Boolean(user)))];
}

function parseVoteCountingArtifacts(
  request: JobRequest,
  challenges: Array<{ raw: string }>,
  entries: VotingEntry[],
  votes: VoteWithError[],
  voters: VoterValidation[],
  scoredFiles: ScoredVotingFile[]
): ParsedArtifacts {
  const deadlineUtc = getVoteDeadlineUtc(request.challenge);
  return {
    summaryLines: [
      `Action: ${request.action}`,
      `Challenge: ${request.challenge}`,
      `Configured login name: ${request.credentials.name}`,
      `Vote deadline (${getVoteDeadlineZoneLabel()}): ${formatVoteDeadlineUtc(request.challenge)}`,
      `Vote deadline (UTC): ${deadlineUtc.toFormat("yyyy-MM-dd HH:mm")}`,
      "",
      `Voting index challenges found: ${challenges.length}`,
      `Voting page entries parsed: ${entries.length}`,
      `Votes parsed: ${votes.length}`,
      `Invalid votes: ${votes.filter((vote) => vote.error > 0).length}`,
      `Late votes: ${votes.filter((vote) => vote.error === 9).length}`,
      `Voters checked: ${voters.length}`,
      `Ranked files: ${scoredFiles.length}`,
      "",
      "Top ranked files:",
      ...scoredFiles.slice(0, 10).map((file) => `- #${file.rank} ${file.fileName} :: score ${file.score} :: support ${file.support}`)
    ],
    challenges,
    files: scoredFiles,
    votes
  };
}
