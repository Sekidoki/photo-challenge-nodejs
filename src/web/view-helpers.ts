import type { JobProgress } from "../core/models.js";
import type { Translator } from "./i18n.js";

export type WorkflowStage = "prepare" | "run" | "review" | "publish";

export type WorkflowStepView = {
  label: string;
  isComplete: boolean;
  isCurrent: boolean;
  isFailed: boolean;
  suffix: string;
};

const WORKFLOW_STAGES: WorkflowStage[] = ["prepare", "run", "review", "publish"];

export function buildWorkflowSteps(current: WorkflowStage, t: Translator, failed = false): WorkflowStepView[] {
  const currentIndex = WORKFLOW_STAGES.indexOf(current);
  return WORKFLOW_STAGES.map((stage, index) => {
    const isFailed = failed && index === currentIndex;
    const isComplete = index < currentIndex;
    return {
      label: t(`workflow.${stage}`),
      isComplete,
      isCurrent: index === currentIndex && !isFailed,
      isFailed,
      suffix: isFailed ? t("workflow.failedSuffix") : isComplete ? t("workflow.completedSuffix") : ""
    };
  });
}

export function workflowStageForJob(job: Pick<JobProgress, "status">): { stage: WorkflowStage; failed: boolean } {
  if (job.status === "completed") return { stage: "review", failed: false };
  if (job.status === "failed") return { stage: "run", failed: true };
  return { stage: "run", failed: false };
}

const STEP_KEYS: Record<string, string> = {
  "Waiting to start": "step.waiting",
  "Completed": "step.completed",
  "Failed": "step.failed",
  "Initializing bot session": "step.initializing",
  "Discovering submission subpages": "step.discoveringSubpages",
  "Loading file metadata": "step.loadingMetadata",
  "Parsing source content": "step.parsing",
  "Publish mode": "step.publishMode",
  "Publishing pages": "step.publishing",
  "Reading challenge list": "step.readingChallengeList",
  "Reading challenge page": "step.readingChallengePage",
  "Rendering outputs": "step.rendering",
  "Rendering voting index section": "step.renderingIndex",
  "Scoring results": "step.scoring",
  "Validating voters": "step.validatingVoters",
  "Validating votes": "step.validatingVotes",
  "Writing logs": "step.writingLogs",
  "Loading scored results": "step.loadingScores",
  "Building maintenance plans": "step.buildingPlans",
  "Writing plan artifacts": "step.writingPlans",
  "Publishing maintenance outputs": "step.publishingMaintenance"
};

/** Translate a workflow step string; unknown steps fall back to the original text. */
export function translateStep(step: string, t: Translator): string {
  const key = STEP_KEYS[step];
  if (key) return t(key);
  const reading = /^Reading (.+)$/u.exec(step);
  if (reading) return t("step.reading", { target: reading[1] ?? "" });
  const archiving = /^Archiving (.+)$/u.exec(step);
  if (archiving) return t("step.archiving", { target: archiving[1] ?? "" });
  return step;
}

export function failureHint(errorMessage: string | null, t: Translator): string {
  const message = errorMessage ?? "";
  if (/log ?in|password|credential|oauth|unauthori[sz]ed|wrongpass/iu.test(message)) return t("progress.hint.login");
  if (/not found|does not exist|missing/iu.test(message)) return t("progress.hint.notFound");
  return t("progress.hint.generic");
}

export function buildRetryUrl(job: Pick<JobProgress, "action" | "challenge" | "publishMode">): string {
  const params = new URLSearchParams({ action: job.action, challenge: job.challenge });
  if (job.publishMode !== "live") params.set("publishMode", job.publishMode);
  return `/?${params.toString()}`;
}

export function toJobStatusView(job: JobProgress, t: Translator) {
  return {
    statusLabel: t(`status.${job.status}`),
    stepLabel: translateStep(job.currentStep, t)
  };
}
