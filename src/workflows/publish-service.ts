import { recordMaintenancePublish } from "../infra/maintenance-publish-history.js";
import { recordOperationalEvent } from "../infra/operational-events.js";
import { recordPublishAudit, type PublishAuditContext } from "../infra/publish-audit.js";
import type { CommonsBot, SavePageResult } from "../services/commons-bot.js";
import { markSandboxPagesForDeletion, type SandboxCleanupPage } from "./job-runner-support.js";
import { applyMaintenancePublishEntry, type MaintenancePublishEntry, type MaintenancePublishMode } from "./maintenance-publish.js";

type MessageReporter = (message: string) => void;

export type StandardPublishPlan = {
  label: string;
  targetTitle: string;
  content: string;
  editSummary: string;
};

export type MaintenancePublishCounts = {
  notifications: number;
  fileAssessments: number;
  announcements: number;
  previousPages: number;
  publishedTotal: number;
  skippedTotal: number;
};

export async function readExistingPageContent(bot: CommonsBot, title: string): Promise<string | null> {
  try {
    const page = await bot.readPage(title);
    return page.content;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Page does not exist:")) {
      return null;
    }
    throw error;
  }
}

export async function publishStandardPages(
  bot: CommonsBot,
  entries: StandardPublishPlan[],
  reportMessage: MessageReporter,
  auditContext?: PublishAuditContext,
  sandboxCleanupPages: SandboxCleanupPage[] = []
): Promise<number> {
  for (const entry of entries) {
    let saveResult: SavePageResult;
    try {
      saveResult = await bot.savePage(entry.targetTitle, entry.content, entry.editSummary);
    } catch (error) {
      if (auditContext) {
        await recordFailedPublish(auditContext, entry.targetTitle);
      }
      throw error;
    }
    if (auditContext) {
      await recordPublishAudit({
        ...auditContext,
        event: "publish.succeeded",
        targetTitle: entry.targetTitle,
        revisionId: saveResult.newRevisionId,
        result: saveResult.result
      });
    }
    reportMessage(`Published ${entry.label} to ${entry.targetTitle}`);
  }

  if (sandboxCleanupPages.length > 0 && auditContext) {
    await markSandboxPagesForDeletion(
      bot,
      sandboxCleanupPages,
      reportMessage,
      auditContext
    );
  }

  return entries.length;
}

export async function publishMaintenanceEditPlans(
  bot: CommonsBot,
  jobId: string,
  entries: MaintenancePublishEntry[],
  mode: MaintenancePublishMode,
  reportMessage: MessageReporter,
  auditContext?: PublishAuditContext,
  sandboxCleanupPages: SandboxCleanupPage[] = []
): Promise<MaintenancePublishCounts> {
  const counts: MaintenancePublishCounts = {
    notifications: 0,
    fileAssessments: 0,
    announcements: 0,
    previousPages: 0,
    publishedTotal: 0,
    skippedTotal: 0
  };

  for (const entry of entries) {
    let currentContent: string | null;
    try {
      currentContent = await readExistingPageContent(bot, entry.liveTargetTitle);
    } catch (error) {
      if (auditContext) {
        await recordFailedPublish(auditContext, entry.targetTitle);
      }
      throw error;
    }
    const nextContent = applyMaintenancePublishEntry(currentContent, entry);

    if (mode === "live" && currentContent !== null && nextContent === currentContent) {
      counts.skippedTotal += 1;
      if (auditContext) {
        await recordPublishAudit({
          ...auditContext,
          event: "publish.skipped",
          targetTitle: entry.targetTitle,
          revisionId: null,
          result: "unchanged"
        });
      }
      reportMessage(`Skipped ${entry.label} for ${entry.liveTargetTitle} because the live page already matches the generated content.`);
      continue;
    }

    let saveResult: SavePageResult;
    try {
      saveResult = await bot.savePage(entry.targetTitle, nextContent, entry.editSummary);
    } catch (error) {
      if (auditContext) {
        await recordFailedPublish(auditContext, entry.targetTitle);
      }
      throw error;
    }
    if (auditContext) {
      await recordPublishAudit({
        ...auditContext,
        event: "publish.succeeded",
        targetTitle: entry.targetTitle,
        revisionId: saveResult.newRevisionId,
        result: saveResult.result
      });
    }
    await recordPublishedMaintenanceEntry(jobId, entry, mode, saveResult, auditContext);
    incrementMaintenanceCount(counts, entry);

    const revNote = saveResult.newRevisionId ? ` (revision ${saveResult.newRevisionId})` : "";
    reportMessage(`Published ${entry.label} to ${entry.targetTitle}${revNote}`);
  }

  if (mode === "live" && sandboxCleanupPages.length > 0 && auditContext) {
    await markSandboxPagesForDeletion(
      bot,
      sandboxCleanupPages,
      reportMessage,
      auditContext
    );
  }

  return counts;
}

async function recordPublishedMaintenanceEntry(
  jobId: string,
  entry: MaintenancePublishEntry,
  mode: MaintenancePublishMode,
  saveResult: SavePageResult,
  auditContext?: PublishAuditContext
): Promise<void> {
  await recordMaintenancePublish(jobId, {
    id: entry.id,
    type: entry.type,
    label: entry.label,
    mode,
    targetTitle: entry.targetTitle,
    liveTargetTitle: entry.liveTargetTitle,
    editSummary: entry.editSummary,
    operator: auditContext?.operator ?? "unknown",
    oauthConsumer: auditContext?.oauthConsumer ?? null,
    publishedAt: new Date().toISOString(),
    revisionId: saveResult.newRevisionId,
    result: saveResult.result
  });
}

async function recordFailedPublish(auditContext: PublishAuditContext, targetTitle: string): Promise<void> {
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
}

function incrementMaintenanceCount(counts: MaintenancePublishCounts, entry: MaintenancePublishEntry): void {
  counts.publishedTotal += 1;
  if (entry.type === "notifications") counts.notifications += 1;
  if (entry.type === "file-assessment") counts.fileAssessments += 1;
  if (entry.type === "announcement") counts.announcements += 1;
  if (entry.type === "previous-page") counts.previousPages += 1;
}
