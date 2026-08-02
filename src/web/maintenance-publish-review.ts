import type { JobProgress } from "../core/models.js";
import { loadMaintenancePublishHistory, type MaintenancePublishRecord } from "../infra/maintenance-publish-history.js";
import type { CommonsBot } from "../services/commons-bot.js";
import { applyMaintenancePublishEntry, buildMaintenancePublishEntriesFromPlan, parseMaintenancePlanResult, type MaintenancePublishEntry, type MaintenancePublishMode } from "../workflows/maintenance-publish.js";
import { readExistingPageContent } from "../workflows/publish-service.js";
import { summarizeMaintenanceArtifact } from "./maintenance-review.js";
import { summarizePublishDiff } from "./publish-review.js";
import { buildDiffSummaryText } from "./standard-publish-review.js";
import { createTranslator, type Translator } from "./i18n.js";

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
  generatedFiles: Array<{ name: string; content: string }>,
  t: Translator = createTranslator("en")
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
      warning: t("maintenance.warning.noPlan"),
      canPublish: false
    };
  }

  const planResult = parseMaintenancePlanResult(overviewFile.content);
  const publishHistory = await loadMaintenancePublishHistory(job.id);
  const overview = summarizeMaintenanceArtifact(overviewFile.name, overviewFile.content, t);
  if (!overview) {
    return {
      overview: null,
      entries: [],
      publishHistory,
      warning: planResult.ok ? t("maintenance.warning.noSummary") : planResult.error,
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
      warning: t("maintenance.warning.noEntries"),
      canPublish: false
    };
  }

  if (!loginName || !bot) {
    return {
      overview: overviewWithLinks,
      entries: entries.map((entry) => ({
        ...entry,
        status: "changed",
        statusLabel: t("review.status.ready"),
        summary: `${entry.liveTargetTitle} -> ${entry.targetTitle}`,
        diffSummary: t("maintenance.diff.signIn"),
        selected: selectedIds.length === 0 || selectedIds.includes(entry.id)
      })),
      publishHistory,
      warning: t("maintenance.warning.signIn"),
      canPublish: false
    };
  }

  const reviewEntries: MaintenancePublishReviewEntry[] = [];
  for (const entry of entries) {
    const currentContent = await readExistingPageContent(bot, entry.liveTargetTitle);
    const nextContent = applyMaintenancePublishEntry(currentContent, entry);
    const diff = summarizePublishDiff(currentContent, nextContent, t);
    reviewEntries.push({
      ...entry,
      status: diff.status,
      statusLabel: diff.status === "new" ? t("review.status.newContent") : diff.status === "same" ? t("review.status.same") : t("review.status.changed"),
      summary: `${entry.liveTargetTitle} -> ${entry.targetTitle}`,
      diffSummary: buildDiffSummaryText(diff, t),
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
