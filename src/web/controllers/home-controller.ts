import type { Request, Response } from "express";
import { DEFAULT_JOB_ACTION } from "../../core/job-actions.js";
import { clearSavedCredential, getCredentialStoreStatus, getSavedName } from "../../infra/credential-store.js";
import { listPersistedJobs } from "../../infra/job-history.js";
import { jobStore } from "../../infra/job-store.js";
import { getOAuthConfigurationMessage, getOAuthSession, isOAuthConfigured } from "../oauth-session.js";
import { createTranslator, getRequestLocale, type SupportedLocale, type Translator } from "../i18n.js";

type HomeDefaults = {
  name: string;
  challenge: string;
  pairedChallenge: string;
  entryMode: string;
  submissionStart: string;
  submissionEnd: string;
  action: string;
  publishMode: string;
};

type HomePageOptions = {
  error?: string;
  success?: string;
  defaults?: Partial<HomeDefaults>;
  oauthUserName?: string | null;
  locale?: SupportedLocale;
};

type HomeRecentJob = {
  id: string;
  action: string;
  challenge: string;
  currentStep: string;
  finishedAtLabel: string;
  progressUrl: string;
  resultUrl: string;
  statusLabel?: string;
  statusCode?: string;
  statusClass?: string;
  timestampLabel?: string;
};

export async function renderHomePage(request: Request, response: Response) {
  const oauthSession = await getOAuthSession(request, response);
  const locale = getRequestLocale(request);
  const t = createTranslator(locale);
  const success = request.query.credentialCleared === "1"
    ? t("home.success.credentialCleared")
    : request.query.signedOut === "1" ? t("home.success.signedOut") : undefined;
  const error = typeof request.query.authError === "string" ? request.query.authError : undefined;
  response.render("home", await buildHomePageViewModel({
    success,
    error,
    locale,
    oauthUserName: oauthSession?.userName ?? null
  }));
}

export async function clearSavedCredentialAction(request: Request, response: Response) {
  if (isOAuthConfigured()) {
    response.status(404).send("Not found");
    return;
  }
  const body = request.body as Record<string, unknown>;
  await clearSavedCredential(String(body.name ?? "").trim());
  response.redirect("/?credentialCleared=1");
}

export async function buildHomePageViewModel(options: HomePageOptions = {}) {
  const locale = options.locale ?? "en";
  const t = createTranslator(locale);
  const savedName = await getSavedName();
  const credentialStore = getCredentialStoreStatus();
  const recentJobs = await getRecentJobs(locale, t);
  const oauthConfigured = isOAuthConfigured();

  return {
    title: t("app.runner"),
    error: options.error,
    success: options.success,
    defaults: {
      name: options.oauthUserName ?? options.defaults?.name ?? savedName ?? process.env.NAME ?? "",
      challenge: options.defaults?.challenge ?? "",
      pairedChallenge: options.defaults?.pairedChallenge ?? "",
      entryMode: options.defaults?.entryMode ?? "single",
      submissionStart: options.defaults?.submissionStart ?? "",
      submissionEnd: options.defaults?.submissionEnd ?? "",
      action: options.defaults?.action ?? DEFAULT_JOB_ACTION,
      publishMode: options.defaults?.publishMode ?? "dry-run"
    },
    savedCredential: savedName
      ? {
          name: savedName,
          backendLabel: credentialStore.backendLabel,
          canPersistAcrossRestarts: credentialStore.canPersistAcrossRestarts
        }
      : null,
    credentialStore,
    oauthConfigured,
    oauthConfigurationMessage: getOAuthConfigurationMessage(),
    oauthUser: options.oauthUserName ? { name: options.oauthUserName } : null,
    recentCompletedJob: recentJobs.find((job) => job.statusCode === "completed") ?? null,
    recentJobs
  };
}

async function getRecentJobs(locale: SupportedLocale, t: Translator): Promise<HomeRecentJob[]> {
  const inMemoryJobs = jobStore.listByStatus().slice().reverse().map((job) => ({
    id: job.id,
    action: formatActionLabel(job.action, t),
    challenge: job.challenge,
    currentStep: job.currentStep,
    finishedAtLabel: formatTimestamp(job.finishedAt, locale, t),
    progressUrl: `/jobs/${job.id}`,
    resultUrl: `/jobs/${job.id}/result`,
    statusLabel: t(`status.${job.status}`),
    statusCode: job.status,
    statusClass: `status-${job.status}`,
    timestampLabel: getTimestampLabel(job, locale, t),
    finishedAt: job.finishedAt?.getTime() ?? 0
  }));

  const persistedJobs = (await listPersistedJobs(10)).map((job) => ({
    id: job.id,
    action: formatActionLabel(job.action, t),
    challenge: job.challenge,
    currentStep: job.currentStep,
    finishedAtLabel: formatTimestamp(job.finishedAt, locale, t),
    progressUrl: `/jobs/${job.id}`,
    resultUrl: `/jobs/${job.id}/result`,
    statusLabel: t(`status.${job.status}`),
    statusCode: job.status,
    statusClass: `status-${job.status}`,
    timestampLabel: getTimestampLabel(job, locale, t),
    finishedAt: job.finishedAt?.getTime() ?? 0
  }));

  const merged = [...inMemoryJobs, ...persistedJobs]
    .filter((job, index, array) => array.findIndex((candidate) => candidate.id === job.id) === index)
    .sort((left, right) => right.finishedAt - left.finishedAt)
    .slice(0, 3)
    .map(({ finishedAt, ...job }) => job);

  return merged;
}

function formatActionLabel(action: string, t: Translator): string {
  if (action === "create-voting") return t("action.createVoting");
  if (action === "count-votes-and-select-winners") return t("action.countVotes");
  if (action === "post-results-maintenance") return t("action.maintenance");
  return action;
}

function getTimestampLabel(
  job: { startedAt?: Date | null; finishedAt: Date | null },
  locale: SupportedLocale,
  t: Translator
) {
  if (job.finishedAt) {
    return t("recent.updated", { timestamp: formatTimestamp(job.finishedAt, locale, t) });
  }

  if (job.startedAt) {
    return t("recent.started", { timestamp: formatTimestamp(job.startedAt, locale, t) });
  }

  return t("recent.waiting");
}

function formatTimestamp(value: Date | null, locale: SupportedLocale, t: Translator): string {
  if (!value) {
    return t("common.unknown");
  }

  return new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}
