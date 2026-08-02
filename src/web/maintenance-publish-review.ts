import type { JobProgress } from "../core/models.js";
import { loadMaintenancePublishHistory, type MaintenancePublishRecord } from "../infra/maintenance-publish-history.js";
import type { CommonsBot } from "../services/commons-bot.js";
import { applyMaintenancePublishEntry, buildMaintenancePublishEntriesFromPlan, parseMaintenancePlanResult, type MaintenancePublishEntry, type MaintenancePublishMode } from "../workflows/maintenance-publish.js";
import { readExistingPageContent } from "../workflows/publish-service.js";
import { summarizeMaintenanceArtifact } from "./maintenance-review.js";
import { summarizePublishDiff } from "./publish-review.js";
import { buildDiffSummaryText } from "./standard-publish-review.js";

export type MaintenancePublishReviewEntry = MaintenancePublishEntry & {
  status: "new" | "same" | "changed";
  statusLabel: string;
  summary: string;
  diffSummary: string;
  selected: boolean;
};

export async function buildMaintenancePublishReview(
  job: JobProgress,
  mode: MaintenancePublishMode,
  selectedIds: string[],
  loginName: string,
  bot: CommonsBot | null,
  generatedFiles: Array<{ name: string; content: string }>
): Promise<{
  overview: ({ previewUrl: string; downloadUrl: string } & ReturnType<typeof summarizeMaintenanceArtifact>) | null;
  entries: MaintenancePublishReviewEntry[];
  publishHistory: MaintenancePublishRecord[];
  warning: string | null;
  canPublish: boolean;
}> {
  const overviewFile = generatedFiles.find((artifact) => artifact.name.endsWith("_maintenance_plan.json")) ?? null;
  if (!overviewFile) {
    return {
      overview: null,
      entries: [],
      publishHistory: [],
      warning: "Maintenance plan JSON was not found for this job.",
      canPublish: false
    };
  }

  const planResult = parseMaintenancePlanResult(overviewFile.content);
  const publishHistory = await loadMaintenancePublishHistory(job.id);
  const overview = summarizeMaintenanceArtifact(overviewFile.name, overviewFile.content);
  if (!overview) {
    return {
      overview: null,
      entries: [],
      publishHistory,
      warning: planResult.ok ? "Maintenance plan JSON could not be summarized for review." : planResult.error,
      canPublish: false
    };
  }

  const overviewWithLinks = {
    ...overview,
    previewUrl: `/jobs/${job.id}/artifacts/generated/${encodeURIComponent(overviewFile.name)}`,
    downloadUrl: `/jobs/${job.id}/artifacts/generated/${encodeURIComponent(overviewFile.name)}/download`
  };

  if (!planResult.ok) {
    return {
      overview: overviewWithLinks,
      entries: [],
      publishHistory,
      warning: planResult.error,
      canPublish: false
    };
  }

  const entries = buildMaintenancePublishEntriesFromPlan(planResult.plan, loginName, mode);

  if (entries.length === 0) {
    return {
      overview: overviewWithLinks,
      entries: [],
      publishHistory,
      warning: "No publishable maintenance entries were found in the maintenance plan.",
      canPublish: false
    };
  }

  if (!loginName || !bot) {
    return {
      overview: overviewWithLinks,
      entries: entries.map((entry) => ({
        ...entry,
        status: "changed",
        statusLabel: "Ready to publish",
        summary: `${entry.liveTargetTitle} -> ${entry.targetTitle}`,
        diffSummary: "Sign in with Wikimedia or save a BotPassword to load live target content before publishing.",
        selected: selectedIds.length === 0 || selectedIds.includes(entry.id)
      })),
      publishHistory,
      warning: "A Wikimedia sign-in or saved BotPassword is required to load live target content for maintenance review and publishing.",
      canPublish: false
    };
  }

  const reviewEntries: MaintenancePublishReviewEntry[] = [];
  for (const entry of entries) {
    const currentContent = await readExistingPageContent(bot, entry.liveTargetTitle);
    const nextContent = applyMaintenancePublishEntry(currentContent, entry);
    const diff = summarizePublishDiff(currentContent, nextContent);
    reviewEntries.push({
      ...entry,
      status: diff.status,
      statusLabel: diff.status === "new" ? "New target content" : diff.status === "same" ? "No changes" : "Changes detected",
      summary: `${entry.liveTargetTitle} -> ${entry.targetTitle}`,
      diffSummary: buildDiffSummaryText(diff),
      selected: selectedIds.length === 0 || selectedIds.includes(entry.id)
    });
  }

  return {
    overview: overviewWithLinks,
    entries: reviewEntries,
    publishHistory,
    warning: null,
    canPublish: true
  };
}
