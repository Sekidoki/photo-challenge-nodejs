import { isVoteCountingAction } from "../core/job-actions.js";
import type { JobProgress } from "../core/models.js";
import type { CommonsBot } from "../services/commons-bot.js";
import { readExistingPageContent, type StandardPublishPlan } from "../workflows/publish-service.js";
import { buildPublishableArtifacts, summarizePublishDiff, type PublishableArtifact } from "./publish-review.js";
import { createTranslator, type Translator } from "./i18n.js";

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
  generatedFiles: Array<{ name: string; content: string }>,
  t: Translator = createTranslator("en")
): Promise<{ entries: PublishReviewEntry[]; warning: string | null }> {
  if (job.action !== "create-voting" && !isVoteCountingAction(job.action)) {
    return {
      entries: [],
      warning: t("review.warning.unsupported")
    };
  }

  if (!loginName) {
    return {
      entries: [],
      warning: t("review.warning.noLogin")
    };
  }

  const artifacts = buildPublishableArtifacts({ ...job, loginName }, generatedFiles, mode, t);
  if (artifacts.length === 0) {
    return {
      entries: [],
      warning: t("review.warning.noFiles")
    };
  }

  if (!bot) {
    return {
      entries: toReviewEntries(job.id, artifacts, new Map(), t),
      warning: t("review.warning.signIn")
    };
  }

  const currentContents = new Map<string, string | null>();
  for (const artifact of artifacts) {
    currentContents.set(artifact.fileName, await readExistingPageContent(bot, artifact.targetTitle));
  }

  return {
    entries: toReviewEntries(job.id, artifacts, currentContents, t),
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
  currentContents: Map<string, string | null>,
  t: Translator
): PublishReviewEntry[] {
  return artifacts.map((artifact) => {
    const summary = summarizePublishDiff(currentContents.get(artifact.fileName) ?? null, artifact.content, t);
    return {
      label: artifact.label,
      fileName: artifact.fileName,
      targetTitle: artifact.targetTitle,
      previewUrl: `/jobs/${jobId}/artifacts/generated/${encodeURIComponent(artifact.fileName)}`,
      downloadUrl: `/jobs/${jobId}/artifacts/generated/${encodeURIComponent(artifact.fileName)}/download`,
      status: summary.status,
      statusLabel: summary.status === "new" ? t("review.status.new") : summary.status === "same" ? t("review.status.same") : t("review.status.changed"),
      summary: buildDiffSummaryText(summary, t),
      firstDifferenceLine: summary.firstDifferenceLine,
      diffRows: summary.rows
    };
  });
}

export function buildDiffSummaryText(
  summary: ReturnType<typeof summarizePublishDiff>,
  t: Translator = createTranslator("en")
): string {
  if (summary.status === "new") {
    return t("review.diff.new", { next: summary.nextLineCount });
  }

  if (summary.status === "same") {
    return t("review.diff.same", { next: summary.nextLineCount });
  }

  return t("review.diff.changed", {
    changed: summary.changedLineCount,
    current: summary.currentLineCount,
    next: summary.nextLineCount
  });
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
