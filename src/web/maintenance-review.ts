type MaintenanceArtifactType = "maintenance-plan" | "notifications" | "announcement" | "previous-page" | "file-assessments";

export type MaintenanceReviewEntry = {
  type: MaintenanceArtifactType;
  label: string;
  description: string;
  fileName: string;
  targetTitle: string | null;
  heading: string | null;
  summary: string;
  excerpt: string[];
};

export function summarizeMaintenanceArtifact(
  fileName: string,
  content: string,
  t: Translator = createTranslator("en")
): MaintenanceReviewEntry | null {
  if (fileName.endsWith("_maintenance_plan.json")) {
    const plan = safeParseJson(content) as {
      mode?: string;
      primaryChallenge?: string;
      pairedChallenge?: string | null;
      sourceJobs?: Array<{ challenge?: string; jobId?: string }>;
      notifications?: unknown[];
      assessmentPlans?: unknown[];
      challengeAnnouncement?: unknown | null;
      previousPageUpdate?: unknown | null;
    } | null;

    if (!plan) {
      return null;
    }

    const sources = Array.isArray(plan.sourceJobs) ? plan.sourceJobs : [];
    const notifications = Array.isArray(plan.notifications) ? plan.notifications.length : 0;
    const assessments = Array.isArray(plan.assessmentPlans) ? plan.assessmentPlans.length : 0;
    const challengeCount = sources.length;
    const pairedLabel = plan.pairedChallenge
      ? t("maintenanceSummary.paired", { challenge: plan.pairedChallenge })
      : t("maintenanceSummary.noPaired");

    return {
      type: "maintenance-plan",
      label: t("maintenanceArtifact.plan.label"),
      description: t("maintenanceArtifact.plan.description"),
      fileName,
      targetTitle: null,
      heading: null,
      summary: t("maintenanceSummary.plan", { challenges: challengeCount, notifications, assessments }),
      excerpt: [
        t("maintenanceSummary.mode", { mode: plan.mode ?? t("mode.dry-run") }),
        t("maintenanceSummary.primary", { challenge: plan.primaryChallenge ?? t("common.unknown") }),
        pairedLabel,
        t("maintenanceSummary.announcement", { state: t(plan.challengeAnnouncement ? "maintenanceSummary.planned" : "maintenanceSummary.notPlanned") }),
        t("maintenanceSummary.previous", { state: t(plan.previousPageUpdate ? "maintenanceSummary.planned" : "maintenanceSummary.notPlanned") }),
        ...sources.slice(0, 3).map((source) => t("maintenanceSummary.source", {
          challenge: source.challenge ?? t("common.unknown"),
          job: source.jobId ?? t("maintenanceSummary.unknownJob")
        }))
      ]
    };
  }

  if (fileName.endsWith("_winner_notifications.txt")) {
    const targets = extractTaggedValues(content, "Target");
    const headings = extractTaggedValues(content, "Heading");
    return {
      type: "notifications",
      label: t("maintenanceArtifact.notifications.label"),
      description: t("maintenanceArtifact.notifications.description"),
      fileName,
      targetTitle: targets[0] ?? null,
      heading: headings[0] ?? null,
      summary: t("maintenanceSummary.notifications", { count: targets.length }),
      excerpt: buildExcerpt(content, 8)
    };
  }

  if (fileName.endsWith("_challenge_announcement.txt")) {
    const targets = extractTaggedValues(content, "Target");
    const headings = extractTaggedValues(content, "Heading");
    return {
      type: "announcement",
      label: t("maintenanceArtifact.announcement.label"),
      description: t("maintenanceArtifact.announcement.description"),
      fileName,
      targetTitle: targets[0] ?? null,
      heading: headings[0] ?? null,
      summary: t("maintenanceSummary.announcementTarget", { target: targets[0] ?? t("maintenanceSummary.targetPage") }),
      excerpt: buildExcerpt(content, 8)
    };
  }

  if (fileName.endsWith("_previous_page_update.txt")) {
    const firstHeading = content.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("=="));
    return {
      type: "previous-page",
      label: t("maintenanceArtifact.previous.label"),
      description: t("maintenanceArtifact.previous.description"),
      fileName,
      targetTitle: "Commons:Photo challenge/Previous",
      heading: firstHeading ?? null,
      summary: t("maintenanceSummary.previousPrepared"),
      excerpt: buildExcerpt(content, 8)
    };
  }

  if (fileName.endsWith("_file_assessments.json")) {
    const plans = safeParseJson(content) as Array<{ title?: string; targetTitle?: string }> | null;
    if (!plans) {
      return null;
    }

    return {
      type: "file-assessments",
      label: t("maintenanceArtifact.assessments.label"),
      description: t("maintenanceArtifact.assessments.description"),
      fileName,
      targetTitle: plans[0]?.targetTitle ?? plans[0]?.title ?? null,
      heading: null,
      summary: t("maintenanceSummary.assessments", { count: plans.length }),
      excerpt: plans.slice(0, 5).map((plan) => plan.targetTitle ?? plan.title ?? t("maintenanceSummary.unknownFile"))
    };
  }

  return null;
}

function extractTaggedValues(content: string, tag: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${tag}:`))
    .map((line) => line.slice(tag.length + 1).trim())
    .filter(Boolean);
}

function buildExcerpt(content: string, maxLines: number): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, maxLines);
}

function safeParseJson(content: string): unknown | null {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}
import { createTranslator, type Translator } from "./i18n.js";
