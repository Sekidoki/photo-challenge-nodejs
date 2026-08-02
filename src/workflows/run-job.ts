import { DateTime } from "luxon";
import type { JobRequest } from "../core/models.js";
import { VOTE_COUNTING_ACTION } from "../core/job-actions.js";
import { config } from "../infra/config.js";
import { jobStore } from "../infra/job-store.js";
import { ensureJobOutputPaths, getJobOutputPaths } from "../infra/output-paths.js";
import { createCommonsBot, isCommonsLoginError, toUserFacingCommonsErrorMessage, type CommonsBot } from "../services/commons-bot.js";
import { runArchivePagesWorkflow } from "./archive-pages.js";
import { runBuildVotingIndexWorkflow } from "./build-voting-index.js";
import { runCreateVotingWorkflow } from "./create-voting.js";
import { runVoteCountingWorkflow } from "./count-votes-and-select-winners.js";
import {
  finalizeJob,
  persistFailedJob,
  slugify,
  updateProgress,
  type AuthenticatedWorkflowContext,
  type WorkflowSummary
} from "./job-runner-support.js";
import { getSandboxRootForName, resolvePublishTarget } from "./job-runner-support.js";
import { runPostResultsMaintenance } from "./run-post-results-maintenance.js";
import { recordOperationalEvent } from "../infra/operational-events.js";
import { buildJobPublishAuditContext } from "../infra/publish-audit.js";

export { getSandboxRootForName, resolvePublishTarget };

export async function runJob(jobId: string, request: JobRequest): Promise<void> {
  const startedAtMs = Date.now();
  let paths: Awaited<ReturnType<typeof ensureJobOutputPaths>> | null = null;

  try {
    paths = await ensureJobOutputPaths(jobId);
    const challengeSlug = slugify(request.challenge);
    const timestamp = DateTime.now().toUTC().toISO();
    let bot: CommonsBot | null = null;
    let currentUser: string | null = null;

    enforcePublishModePolicy(request);

    if (request.action === "post-results-maintenance") {
      if (request.publishMode !== "dry-run") {
        updateProgress(jobId, {
          percent: 10,
          step: "Initializing bot session",
          message: "Logging into Wikimedia Commons with mwn for post-results publishing."
        });

        bot = await createWorkflowBot(request);
        currentUser = await bot.getCurrentUser();
        jobStore.appendMessage(jobId, `Logged in as ${currentUser ?? "unknown user"}.`);
      }

      const maintenance = await runPostResultsMaintenance(
        paths,
        request,
        (percent, step, message) => updateProgress(jobId, { percent, step, message }),
        (message) => jobStore.appendMessage(jobId, message),
        bot
          ? {
              bot,
              jobId,
              loginName: request.credentials.name,
              publishAuditContext: buildJobPublishAuditContext(jobId, request)
            }
          : null
      );
      await finalizeAndComplete(jobId, request, paths.logsDir, currentUser, timestamp, {
        sourceCount: maintenance.sourceCount,
        challengeCount: maintenance.challengeCount,
        fileCount: maintenance.fileCount,
        voteCount: maintenance.voteCount
      });
      return;
    }

    updateProgress(jobId, {
      percent: 10,
      step: "Initializing bot session",
      message: "Logging into Wikimedia Commons with mwn."
    });

    bot = await createWorkflowBot(request);
    currentUser = await bot.getCurrentUser();
    jobStore.appendMessage(jobId, `Logged in as ${currentUser ?? "unknown user"}.`);

    const context: AuthenticatedWorkflowContext = {
      bot,
      paths,
      jobId,
      request,
      challengeSlug,
      publishAuditContext: buildJobPublishAuditContext(jobId, request)
    };
    const summary = await runAuthenticatedWorkflow(context);
    await finalizeAndComplete(jobId, request, paths.logsDir, currentUser, timestamp, summary);
  } catch (error) {
    const message = toUserFacingCommonsErrorMessage(error);
    if (request.publishMode !== "dry-run" && isCommonsLoginError(error)) {
      recordOperationalEvent({
        event: "publish.failure",
        outcome: "failure",
        jobId,
        workflow: request.action,
        mode: request.publishMode,
        operator: request.credentials.name,
        oauthConsumer: request.credentials.oauthAccessToken ? config.oauth.clientId : null,
        failureStage: "authentication"
      });
    }
    jobStore.appendMessage(jobId, `Job failed: ${message}`);
    if (paths) {
      await persistFailedJob(paths.logsDir, jobId, request, message);
    }
    jobStore.markFailed(jobId, message);
  } finally {
    recordOperationalEvent({
      event: "job.duration",
      outcome: jobStore.get(jobId)?.status === "completed" ? "success" : "failure",
      jobId,
      workflow: request.action,
      mode: request.publishMode,
      operator: request.credentials.name,
      oauthConsumer: request.credentials.oauthAccessToken ? config.oauth.clientId : null,
      durationMs: Date.now() - startedAtMs
    });
  }
}

async function createWorkflowBot(request: JobRequest): Promise<CommonsBot> {
  return createCommonsBot({
    apiUrl: config.commonsApiUrl,
    userAgent: config.userAgent,
    credentials: request.credentials
  });
}

async function runAuthenticatedWorkflow(context: AuthenticatedWorkflowContext): Promise<WorkflowSummary> {
  if (context.request.action === "archive-pages") {
    return runArchivePagesWorkflow(context);
  }

  if (context.request.action === "build-voting-index") {
    return runBuildVotingIndexWorkflow(context);
  }

  if (context.request.action === "create-voting") {
    return runCreateVotingWorkflow(context);
  }

  if (context.request.action === VOTE_COUNTING_ACTION) {
    return runVoteCountingWorkflow(context);
  }

  throw new Error(`Unsupported workflow action: ${context.request.action}`);
}

async function finalizeAndComplete(
  jobId: string,
  request: JobRequest,
  logsDir: string,
  currentUser: string | null,
  timestamp: string | null,
  summary: WorkflowSummary
): Promise<void> {
  await finalizeJob(
    logsDir,
    jobId,
    request,
    currentUser,
    timestamp,
    summary.sourceCount,
    summary.challengeCount,
    summary.fileCount,
    summary.voteCount
  );
  jobStore.appendMessage(jobId, summary.completionMessage ?? `Artifacts written to ${getJobOutputPaths(jobId).jobRoot}`);
  jobStore.markCompleted(jobId);
}

function enforcePublishModePolicy(request: JobRequest): void {
  if (request.action === "archive-pages" && request.publishMode === "sandbox") {
    throw new Error("archive-pages does not support sandbox publishing. Use dry-run or live.");
  }

  if (request.action === "build-voting-index" && request.publishMode !== "dry-run") {
    throw new Error("build-voting-index currently supports only --publish-mode dry-run to avoid overwriting the shared voting index.");
  }
}
