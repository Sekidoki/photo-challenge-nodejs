import { isVoteCountingAction } from "../core/job-actions.js";
import type { JobProgress } from "../core/models.js";
import type { CommonsBot } from "../services/commons-bot.js";
import { readExistingPageContent, type StandardPublishPlan } from "../workflows/publish-service.js";
import { buildPublishableArtifacts, summarizePublishDiff, type PublishableArtifact } from "./publish-review.js";

export type PublishReviewEntry = {
  label: string;
  fileName: string;
  targetTitle: string;
  previewUrl: string;
  downloadUrl: string;
  status: "new" | "same" | "changed";
  statusLabel: string;
  summary: string;
  firstDifferenceLine: number | null;
  diffRows: Array<{
    kind: string;
    currentLineNumber: number | null;
    nextLineNumber: number | null;
    currentText: string;
    nextText: string;
    isSame: boolean;
    isAdd: boolean;
    isRemove: boolean;
    isChange: boolean;
    isSkip: boolean;
  }>;
};

export async function buildStandardPublishReview(
  job: JobProgress,
  mode: "sandbox" | "live",
  loginName: string,
  bot: CommonsBot | null,
  generatedFiles: Array<{ name: string; content: string }>
): Promise<{ entries: PublishReviewEntry[]; warning: string | null }> {
  if (job.action !== "create-voting" && !isVoteCountingAction(job.action)) {
    return {
      entries: [],
      warning: "This workflow does not publish challenge pages yet, so Web publish review is not available."
    };
  }

  if (!loginName) {
    return {
      entries: [],
      warning: "This job does not record a login name, so the publish target cannot be reconstructed. Re-run the job before using Web publish review."
    };
  }

  const artifacts = buildPublishableArtifacts({ ...job, loginName }, generatedFiles, mode);
  if (artifacts.length === 0) {
    return {
      entries: [],
      warning: "No publishable generated files were found for this job."
    };
  }

  if (!bot) {
    return {
      entries: toReviewEntries(job.id, artifacts, new Map()),
      warning: "A Wikimedia sign-in or saved BotPassword is required to load the current target pages for diff review. Sign in, then reopen this screen."
    };
  }

  const currentContents = new Map<string, string | null>();
  for (const artifact of artifacts) {
    currentContents.set(artifact.fileName, await readExistingPageContent(bot, artifact.targetTitle));
  }

  return {
    entries: toReviewEntries(job.id, artifacts, currentContents),
    warning: null
  };
}

export function toStandardPublishPlan(job: JobProgress, artifact: PublishableArtifact): StandardPublishPlan {
  return {
    label: artifact.label,
    targetTitle: artifact.targetTitle,
    content: artifact.content,
    editSummary: buildPublishSummary(job, artifact)
  };
}

function toReviewEntries(
  jobId: string,
  artifacts: PublishableArtifact[],
  currentContents: Map<string, string | null>
): PublishReviewEntry[] {
  return artifacts.map((artifact) => {
    const summary = summarizePublishDiff(currentContents.get(artifact.fileName) ?? null, artifact.content);
    return {
      label: artifact.label,
      fileName: artifact.fileName,
      targetTitle: artifact.targetTitle,
      previewUrl: `/jobs/${jobId}/artifacts/generated/${encodeURIComponent(artifact.fileName)}`,
      downloadUrl: `/jobs/${jobId}/artifacts/generated/${encodeURIComponent(artifact.fileName)}/download`,
      status: summary.status,
      statusLabel: summary.status === "new" ? "New page" : summary.status === "same" ? "No changes" : "Changes detected",
      summary: buildDiffSummaryText(summary),
      firstDifferenceLine: summary.firstDifferenceLine,
      diffRows: summary.rows
    };
  });
}

export function buildDiffSummaryText(summary: ReturnType<typeof summarizePublishDiff>): string {
  if (summary.status === "new") {
    return `This target page does not exist yet. ${summary.nextLineCount} line(s) will be created.`;
  }

  if (summary.status === "same") {
    return `The target page already matches this generated artifact (${summary.nextLineCount} line(s)).`;
  }

  return `${summary.changedLineCount} differing line(s) detected. Current: ${summary.currentLineCount} line(s). Generated: ${summary.nextLineCount} line(s).`;
}

function buildPublishSummary(job: JobProgress, artifact: PublishableArtifact): string {
  if (artifact.targetType === "voting") {
    return isVoteCountingAction(job.action)
      ? "Photo Challenge bot: revise voting page after validation"
      : "Photo Challenge bot: create voting page";
  }

  if (artifact.targetType === "result") {
    return "Photo Challenge bot: create result page";
  }

  return "Photo Challenge bot: create winners page";
}
