import { readFile } from "node:fs/promises";
import type { Request, Response } from "express";
import type { BotCredentials, JobProgress, JobRequest } from "../../core/models.js";
import {
  DEFAULT_JOB_ACTION,
  buildValidatedJobRequest,
  isVoteCountingAction,
  parseSubmissionWindowValues
} from "../../core/job-actions.js";
import { getCredentialPassword, rememberCredential } from "../../infra/credential-store.js";
import { config } from "../../infra/config.js";
import { loadPersistedJob } from "../../infra/job-history.js";
import { jobStore } from "../../infra/job-store.js";
import { getJobOutputPaths } from "../../infra/output-paths.js";
import { createCommonsBot, isCommonsLoginError, toUserFacingCommonsErrorMessage } from "../../services/commons-bot.js";
import { runJob } from "../../workflows/run-job.js";
import { buildMaintenancePublishEntriesFromPlan, parseMaintenancePlanResult, type MaintenancePublishMode } from "../../workflows/maintenance-publish.js";
import { publishMaintenanceEditPlans, publishStandardPages } from "../../workflows/publish-service.js";
import {
  getArtifactKind,
  getArtifactName,
  classifyGeneratedArtifacts,
  listArtifacts,
  loadCoreArtifacts,
  loadGeneratedFiles,
  resolveArtifactPath
} from "../artifacts.js";
import { buildMaintenancePublishReview } from "../maintenance-publish-review.js";
import { buildPublishableArtifacts } from "../publish-review.js";
import { buildStandardPublishReview, toStandardPublishPlan } from "../standard-publish-review.js";
import { buildHomePageViewModel } from "./home-controller.js";
import { getOAuthSession, isOAuthConfigured, validateCsrfToken } from "../oauth-session.js";
import { createTranslator, getRequestLocale, type Translator } from "../i18n.js";
import { recordOperationalEvent } from "../../infra/operational-events.js";
import type { PublishAuditContext } from "../../infra/publish-audit.js";
import { isJobOwnedBy } from "../job-access.js";

const activePublishOperations = new Set<string>();

function parseSubmissionWindow(body: Record<string, unknown>) {
  const startsAt = String(body.submissionStart ?? "").trim();
  const endsAt = String(body.submissionEnd ?? "").trim();
  const asUtcIso = (value: string) => value && !/(?:Z|[+-]\d\d:\d\d)$/u.test(value)
    ? `${value}${/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value) ? ":00" : ""}Z`
    : value;
  return parseSubmissionWindowValues(asUtcIso(startsAt), asUtcIso(endsAt));
}

function validateHomeFields(body: Record<string, unknown>, oauthRequired: boolean, hasSavedCredential: boolean, t: Translator) {
  const errors: Record<string, string> = {};
  const action = String(body.action ?? DEFAULT_JOB_ACTION);
  if (!String(body.challenge ?? "").trim()) errors.challenge = t("home.error.challengeRequired");
  if (!oauthRequired && !String(body.name ?? "").trim()) errors.name = t("home.error.nameRequired");
  if (!oauthRequired && !hasSavedCredential && !String(body.botPassword ?? "")) errors.botPassword = t("home.error.passwordRequired");
  const start = String(body.submissionStart ?? "").trim();
  const end = String(body.submissionEnd ?? "").trim();
  if (action === "create-voting" && Boolean(start) !== Boolean(end)) {
    const message = t("home.error.datesTogether"); errors.submissionStart = message; errors.submissionEnd = message;
  } else if (action === "create-voting" && start && end) {
    try { parseSubmissionWindow(body); } catch {
      const message = t("home.error.dateOrder"); errors.submissionStart = message; errors.submissionEnd = message;
    }
  }
  return errors;
}

function buildJobRequest(body: Record<string, unknown>): JobRequest {
  return buildValidatedJobRequest({
    action: String(body.action ?? DEFAULT_JOB_ACTION),
    challenge: String(body.challenge ?? ""),
    pairedChallenge: String(body.pairedChallenge ?? ""),
    entryMode: String(body.entryMode ?? "single"),
    submissionWindow: parseSubmissionWindow(body),
    credentials: {
      name: String(body.name ?? "").trim(),
      botPassword: String(body.botPassword ?? "")
    },
    publishMode: String(body.publishMode ?? "dry-run")
  }, {
    entryMode: "entry mode",
    publishMode: "publish mode",
    source: "source"
  });
}

function shouldRememberCredential(body: Record<string, unknown>): boolean {
  return body.rememberCredential === "on" || body.rememberCredential === "true";
}

function getRouteId(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeSelectedValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).filter(Boolean);
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
}

function getReviewMode(value: unknown, job: JobProgress): "sandbox" | "live" {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "live" || raw === "sandbox") {
    return raw;
  }

  return job.publishMode === "live" ? "live" : "sandbox";
}

function formatActionLabel(action: string, t: Translator): string {
  if (action === "create-voting") return t("action.createVoting");
  if (action === "count-votes-and-select-winners") return t("action.countVotes");
  if (action === "post-results-maintenance") return t("action.maintenance");
  return action;
}

async function getJobSnapshot(
  jobId: string,
  request: Request,
  response: Response
): Promise<JobProgress | null> {
  const job = jobStore.get(jobId) ?? (await loadPersistedJob(jobId));
  if (!job || !isOAuthConfigured()) return job;

  const session = await getOAuthSession(request, response);
  if (!session || !isJobOwnedBy(job.loginName, session.userName)) return null;

  return job;
}

export async function createJob(request: Request, response: Response) {
  const body = request.body as Record<string, unknown>;
  const locale = getRequestLocale(request);
  const t = createTranslator(locale);
  const oauthSession = await getOAuthSession(request, response);
  const oauthRequired = isOAuthConfigured();
  if (oauthRequired && (!oauthSession || !validateCsrfToken(oauthSession, body.csrfToken))) {
    response.status(oauthSession ? 403 : 401).render(
      "home",
      await buildHomePageViewModel({
        error: oauthSession
          ? t("home.error.expiredForm")
          : t("home.error.signInFirst"),
        locale,
        oauthUserName: oauthSession?.userName ?? null,
        defaults: buildHomeDefaults(body)
      })
    );
    return;
  }

  const authenticatedBody = oauthSession
    ? { ...body, name: oauthSession.userName, botPassword: "" }
    : body;
  const submittedName = String(authenticatedBody.name ?? "").trim();
  const hasSavedCredential = oauthRequired || !submittedName ? false : Boolean(await getCredentialPassword(submittedName));
  const fieldErrors = validateHomeFields(authenticatedBody, oauthRequired, hasSavedCredential, t);
  if (Object.keys(fieldErrors).length > 0) {
    response.status(400).render("home", await buildHomePageViewModel({
      error: t("home.error.summary"), fieldErrors, locale,
      oauthUserName: oauthSession?.userName ?? null, defaults: buildHomeDefaults(authenticatedBody)
    }));
    return;
  }
  let jobRequest: JobRequest;
  try {
    jobRequest = buildJobRequest(authenticatedBody);
    if (oauthSession) {
      jobRequest.credentials.oauthAccessToken = oauthSession.accessToken;
    }
  } catch (error) {
    response.status(400).render(
      "home",
      await buildHomePageViewModel({
        error: error instanceof Error ? error.message : t("home.error.invalidSettings"),
        fieldErrors: error instanceof Error && /submission|date\/time|start earlier/u.test(error.message)
          ? { submissionStart: t("home.error.dateOrder"), submissionEnd: t("home.error.dateOrder") }
          : {},
        locale,
        oauthUserName: oauthSession?.userName ?? null,
        defaults: buildHomeDefaults(authenticatedBody)
      })
    );
    return;
  }
  const rememberRequested = shouldRememberCredential(body);

  if (!jobRequest.credentials.oauthAccessToken && !jobRequest.credentials.botPassword && jobRequest.credentials.name) {
    jobRequest.credentials.botPassword = (await getCredentialPassword(jobRequest.credentials.name)) ?? "";
  }

  if (
    !jobRequest.challenge
    || !jobRequest.credentials.name
    || (!jobRequest.credentials.botPassword && !jobRequest.credentials.oauthAccessToken)
  ) {
    response.status(400).render(
      "home",
      await buildHomePageViewModel({
        error: oauthRequired
          ? t("home.error.oauthRequired")
          : t("home.error.localRequired"),
        locale,
        oauthUserName: oauthSession?.userName ?? null,
        defaults: {
          name: jobRequest.credentials.name,
          challenge: jobRequest.challenge,
          pairedChallenge: jobRequest.pairedChallenge,
          entryMode: jobRequest.entryMode,
          submissionStart: jobRequest.submissionWindow?.startsAt,
          submissionEnd: jobRequest.submissionWindow?.endsAt,
          action: jobRequest.action,
          publishMode: jobRequest.publishMode
        }
      })
    );
    return;
  }

  if (rememberRequested && !jobRequest.credentials.oauthAccessToken) {
    await rememberCredential(jobRequest.credentials.name, jobRequest.credentials.botPassword);
  }

  const placeholderJob = jobStore.create(jobRequest, getJobOutputPaths("pending").jobRoot);
  const actualOutputDir = getJobOutputPaths(placeholderJob.id).jobRoot;
  jobStore.update(placeholderJob.id, { outputDir: actualOutputDir });

  void runJob(placeholderJob.id, jobRequest);

  response.redirect(`/jobs/${placeholderJob.id}`);
}

export async function renderJobProgress(request: Request, response: Response) {
  const t = createTranslator(getRequestLocale(request));
  const job = await getJobSnapshot(getRouteId(request.params.id), request, response);
  if (!job) {
    response.status(404).send(t("error.jobNotFound"));
    return;
  }

  const coreArtifacts = job.status === "completed" ? await loadCoreArtifacts(job.id, job.action, undefined, t) : [];

  response.render("progress", {
    title: `${t("progress.title")} ${job.id}`,
    job,
    jobActionLabel: formatActionLabel(job.action, t),
    coreArtifacts
  });
}

export async function getJobStatus(request: Request, response: Response) {
  const t = createTranslator(getRequestLocale(request));
  const job = await getJobSnapshot(getRouteId(request.params.id), request, response);
  if (!job) {
    response.status(404).json({ error: t("error.jobNotFound") });
    return;
  }

  response.json(job);
}

export async function renderJobResult(request: Request, response: Response) {
  const t = createTranslator(getRequestLocale(request));
  const job = await getJobSnapshot(getRouteId(request.params.id), request, response);
  if (!job) {
    response.status(404).send(t("error.jobNotFound"));
    return;
  }

  const artifacts = await listArtifacts(job.id);
  const { coreArtifacts, otherGeneratedFiles } = classifyGeneratedArtifacts(artifacts.generated, job.action, t);
  const reviewMode = getReviewMode(request.query.mode, job);
  const notice = typeof request.query.notice === "string" ? request.query.notice : null;
  const canPublishReview = job.action === "create-voting" || isVoteCountingAction(job.action);
  const hasMaintenanceReview = job.action === "post-results-maintenance";

  response.render("result", {
    title: `${t("result.title")} ${job.id}`,
    job,
    jobActionLabel: formatActionLabel(job.action, t),
    coreArtifacts,
    generatedFiles: otherGeneratedFiles,
    logFiles: artifacts.logs,
    publishReviewUrl: `/jobs/${job.id}/publish-review?mode=${reviewMode}`,
    publishNotice: notice,
    publishModeLabel: t(`mode.${reviewMode}`),
    canPublishReview,
    hasMaintenanceReview,
    maintenanceReviewUrl: `/jobs/${job.id}/maintenance-review`
  });
}

export async function renderPublishReview(request: Request, response: Response) {
  const t = createTranslator(getRequestLocale(request));
  try {
    const job = await getJobSnapshot(getRouteId(request.params.id), request, response);
    if (!job) {
      response.status(404).send(t("error.jobNotFound"));
      return;
    }

    const mode = getReviewMode(request.query.mode, job);
    const credentials = await resolveWebCredentials(request, response, job);
    const loginName = credentials?.name ?? resolveLoginName(job);
    const generatedFiles = await loadGeneratedFiles(job.id);
    const review = await buildStandardPublishReview(
      job,
      mode,
      loginName,
      await createReviewBot(credentials),
      generatedFiles,
      t
    );

    response.render("publish-review", {
      title: `${t("publishReview.title")} ${job.id}`,
      job,
      jobActionLabel: formatActionLabel(job.action, t),
      reviewEntries: review.entries,
      reviewMode: mode,
      alternateMode: mode === "sandbox" ? "live" : "sandbox",
      alternateModeLabel: t(`mode.${mode === "sandbox" ? "live" : "sandbox"}`),
      alternateModeUrl: `/jobs/${job.id}/publish-review?mode=${mode === "sandbox" ? "live" : "sandbox"}`,
      reviewWarning: review.warning,
      reviewNotice: typeof request.query.notice === "string" ? request.query.notice : null,
      publishContext: buildPublishContext(credentials?.name ?? loginName, mode, review.entries.length, t)
    });
  } catch (error) {
    if (isCommonsLoginError(error)) {
      const jobId = getRouteId(request.params.id);
      const mode = typeof request.query.mode === "string" ? request.query.mode : "sandbox";
      response.redirect(`/jobs/${jobId}/result?notice=${encodeURIComponent(toUserFacingCommonsErrorMessage(error))}&mode=${encodeURIComponent(mode)}`);
      return;
    }

    throw error;
  }
}

export async function renderMaintenanceReview(request: Request, response: Response) {
  const t = createTranslator(getRequestLocale(request));
  try {
    const job = await getJobSnapshot(getRouteId(request.params.id), request, response);
    if (!job) {
      response.status(404).send(t("error.jobNotFound"));
      return;
    }

    if (job.action !== "post-results-maintenance") {
      response.redirect(`/jobs/${job.id}/result?notice=${encodeURIComponent(t("publish.error.standardMaintenanceView"))}`);
      return;
    }

    const mode = getReviewMode(request.query.mode, job) as MaintenancePublishMode;
    const selectedIds = normalizeSelectedValues(request.query.selected);
    const credentials = await resolveWebCredentials(request, response, job);
    const loginName = credentials?.name ?? resolveLoginName(job);
    const generatedFiles = await loadGeneratedFiles(job.id);
    const review = await buildMaintenancePublishReview(
      job,
      mode,
      selectedIds,
      loginName,
      await createReviewBot(credentials),
      generatedFiles,
      t
    );

    response.render("maintenance-review", {
      title: `${t("maintenanceReview.title")} ${job.id}`,
      job,
      jobActionLabel: formatActionLabel(job.action, t),
      overview: review.overview,
      reviewEntries: review.entries,
      publishHistory: review.publishHistory,
      reviewMode: mode,
      alternateMode: mode === "sandbox" ? "live" : "sandbox",
      alternateModeLabel: t(`mode.${mode === "sandbox" ? "live" : "sandbox"}`),
      alternateModeUrl: `/jobs/${job.id}/maintenance-review?mode=${mode === "sandbox" ? "live" : "sandbox"}`,
      reviewWarning: review.warning,
      reviewNotice: typeof request.query.notice === "string" ? request.query.notice : null,
      canPublish: review.canPublish,
      publishContext: buildPublishContext(credentials?.name ?? loginName, mode, review.entries.length, t)
    });
  } catch (error) {
    if (isCommonsLoginError(error)) {
      const jobId = getRouteId(request.params.id);
      const mode = typeof request.query.mode === "string" ? request.query.mode : "sandbox";
      response.redirect(`/jobs/${jobId}/result?notice=${encodeURIComponent(toUserFacingCommonsErrorMessage(error))}&mode=${encodeURIComponent(mode)}`);
      return;
    }

    throw error;
  }
}

export async function publishMaintenanceOutputs(request: Request, response: Response) {
  const t = createTranslator(getRequestLocale(request));
  const job = await getJobSnapshot(getRouteId(request.params.id), request, response);
  if (!job) {
    response.status(404).send(t("error.jobNotFound"));
    return;
  }

  if (job.action !== "post-results-maintenance") {
    response.redirect(`/jobs/${job.id}/result?notice=${encodeURIComponent(t("publish.error.maintenanceUnsupported"))}`);
    return;
  }

  const body = request.body as Record<string, unknown>;
  const mode = getReviewMode(body.mode ?? request.query.mode, job) as MaintenancePublishMode;
  const credentials = await resolveWebCredentials(request, response, job);
  if (!credentials || !(await validateWriteRequest(request, response))) {
    response.redirect(`/jobs/${job.id}/maintenance-review?mode=${mode}&notice=${encodeURIComponent(t("publish.error.signInAgain"))}`);
    return;
  }
  const selectedIds = normalizeSelectedValues(body.selected);
  if (selectedIds.length === 0) {
    response.redirect(`/jobs/${job.id}/maintenance-review?mode=${mode}&notice=${encodeURIComponent(t("publish.error.selectMaintenance"))}`);
    return;
  }

  const loginName = credentials.name;

  const generatedFiles = await loadGeneratedFiles(job.id);
  const planFile = generatedFiles.find((artifact) => artifact.name.endsWith("_maintenance_plan.json"));
  if (!planFile) {
    response.redirect(`/jobs/${job.id}/maintenance-review?mode=${mode}&notice=${encodeURIComponent(t("maintenance.warning.noPlan"))}`);
    return;
  }

  const planResult = parseMaintenancePlanResult(planFile.content);
  if (!planResult.ok) {
    response.redirect(`/jobs/${job.id}/maintenance-review?mode=${mode}&notice=${encodeURIComponent(planResult.error)}`);
    return;
  }

  const entries = buildMaintenancePublishEntriesFromPlan(planResult.plan, loginName, mode);
  const selectedEntries = entries.filter((entry) => selectedIds.includes(entry.id));
  if (selectedEntries.length === 0) {
    response.redirect(`/jobs/${job.id}/maintenance-review?mode=${mode}&notice=${encodeURIComponent(t("publish.error.noneSelected"))}`);
    return;
  }

  const operationKey = `${job.id}:${mode}:maintenance`;
  if (activePublishOperations.has(operationKey)) {
    response.status(409).send(t("publish.error.inProgress"));
    return;
  }
  activePublishOperations.add(operationKey);
  try {

  let bot;
  try {
    bot = await createCommonsBot({
      apiUrl: config.commonsApiUrl,
      userAgent: config.userAgent,
      credentials
    });
  } catch (error) {
    recordPublishAuthenticationFailure(job, mode, credentials);
    response.redirect(`/jobs/${job.id}/maintenance-review?mode=${mode}&notice=${encodeURIComponent(toUserFacingCommonsErrorMessage(error))}`);
    return;
  }

  const result = await publishMaintenanceEditPlans(
    bot,
    job.id,
    selectedEntries,
    mode,
    (message) => {
      if (jobStore.get(job.id)) {
        jobStore.appendMessage(job.id, message);
      }
    },
    buildWebPublishAuditContext(job, mode, credentials),
    mode === "live"
      ? buildMaintenancePublishEntriesFromPlan(planResult.plan, loginName, "sandbox")
        .filter((entry) => selectedIds.includes(entry.id))
        .map((entry) => ({ label: entry.label, targetTitle: entry.targetTitle }))
      : []
  );
  const skipped = result.skippedTotal > 0 ? t("publish.notice.skipped", { count: result.skippedTotal }) : "";
  response.redirect(`/jobs/${job.id}/maintenance-review?mode=${mode}&notice=${encodeURIComponent(t("publish.notice.maintenancePublished", {
    count: result.publishedTotal,
    mode: t(`mode.${mode}`),
    skipped
  }))}`);
  } finally {
    activePublishOperations.delete(operationKey);
  }
}

export async function publishJobOutputs(request: Request, response: Response) {
  const t = createTranslator(getRequestLocale(request));
  const job = await getJobSnapshot(getRouteId(request.params.id), request, response);
  if (!job) {
    response.status(404).send(t("error.jobNotFound"));
    return;
  }

  if (job.action !== "create-voting" && !isVoteCountingAction(job.action)) {
    response.redirect(`/jobs/${job.id}/result?notice=${encodeURIComponent(t("publish.error.workflowUnsupported"))}`);
    return;
  }

  const body = request.body as Record<string, unknown>;
  const mode = getReviewMode(body.mode ?? request.query.mode, job);
  const credentials = await resolveWebCredentials(request, response, job);
  if (!credentials || !(await validateWriteRequest(request, response))) {
    response.redirect(`/jobs/${job.id}/publish-review?mode=${mode}&notice=${encodeURIComponent(t("publish.error.signInAgain"))}`);
    return;
  }
  const loginName = credentials.name;

  const generatedFiles = await loadGeneratedFiles(job.id);
  const artifacts = buildPublishableArtifacts({ ...job, loginName }, generatedFiles, mode);
  if (artifacts.length === 0) {
    response.redirect(`/jobs/${job.id}/publish-review?mode=${mode}&notice=${encodeURIComponent(t("review.warning.noFiles"))}`);
    return;
  }

  const operationKey = `${job.id}:${mode}:standard`;
  if (activePublishOperations.has(operationKey)) {
    response.status(409).send(t("publish.error.inProgress"));
    return;
  }
  activePublishOperations.add(operationKey);
  try {

  let bot;
  try {
    bot = await createCommonsBot({
      apiUrl: config.commonsApiUrl,
      userAgent: config.userAgent,
      credentials
    });
  } catch (error) {
    recordPublishAuthenticationFailure(job, mode, credentials);
    response.redirect(`/jobs/${job.id}/publish-review?mode=${mode}&notice=${encodeURIComponent(toUserFacingCommonsErrorMessage(error))}`);
    return;
  }

  const publishedCount = await publishStandardPages(
    bot,
    artifacts.map((artifact) => toStandardPublishPlan(job, artifact)),
    (message) => {
      if (jobStore.get(job.id)) {
        jobStore.appendMessage(job.id, message);
      }
    },
    buildWebPublishAuditContext(job, mode, credentials),
    mode === "live"
      ? buildPublishableArtifacts({ ...job, loginName }, generatedFiles, "sandbox")
        .map((artifact) => ({ label: artifact.label, targetTitle: artifact.targetTitle }))
      : []
  );

  response.redirect(`/jobs/${job.id}/result?notice=${encodeURIComponent(t("publish.notice.pagesPublished", {
    count: publishedCount,
    mode: t(`mode.${mode}`)
  }))}`);
  } finally {
    activePublishOperations.delete(operationKey);
  }
}

export async function renderArtifactPreview(request: Request, response: Response) {
  const t = createTranslator(getRequestLocale(request));
  const jobId = getRouteId(request.params.id);
  const job = await getJobSnapshot(jobId, request, response);
  if (!job) {
    response.status(404).send(t("error.jobNotFound"));
    return;
  }

  const kind = getArtifactKind(request.params.kind);
  const fileName = getArtifactName(request.params.fileName);
  if (!kind || !fileName) {
    response.status(400).send(t("error.invalidArtifactPath"));
    return;
  }

  const artifactPath = resolveArtifactPath(jobId, kind, fileName);
  if (!artifactPath) {
    response.status(404).send(t("error.artifactNotFound"));
    return;
  }

  const content = await readFile(artifactPath, "utf8");
  const coreArtifacts = kind === "generated" ? await loadCoreArtifacts(job.id, job.action, fileName, t) : [];

  response.render("artifact-preview", {
    title: `${t("artifact.title")} — ${fileName}`,
    job,
    fileName,
    kind,
    content,
    coreArtifacts,
    downloadUrl: `/jobs/${job.id}/artifacts/${kind}/${encodeURIComponent(fileName)}/download`
  });
}

export async function downloadArtifact(request: Request, response: Response) {
  const t = createTranslator(getRequestLocale(request));
  const jobId = getRouteId(request.params.id);
  const job = await getJobSnapshot(jobId, request, response);
  if (!job) {
    response.status(404).send(t("error.jobNotFound"));
    return;
  }

  const kind = getArtifactKind(request.params.kind);
  const fileName = getArtifactName(request.params.fileName);
  if (!kind || !fileName) {
    response.status(400).send(t("error.invalidArtifactPath"));
    return;
  }

  const artifactPath = resolveArtifactPath(jobId, kind, fileName);
  if (!artifactPath) {
    response.status(404).send(t("error.artifactNotFound"));
    return;
  }

  response.download(artifactPath, fileName);
}

function resolveLoginName(job: JobProgress): string {
  return job.loginName || process.env.NAME?.trim() || "";
}

async function resolveBotPassword(loginName: string): Promise<string> {
  if (!loginName) {
    return "";
  }

  const saved = await getCredentialPassword(loginName);
  if (saved) return saved;
  if (process.env.NAME?.trim() === loginName) {
    return process.env.BOT_PASSWORD?.trim() ?? "";
  }
  return "";
}

async function createReviewBot(credentials: BotCredentials | null) {
  if (!credentials) {
    return null;
  }

  return createCommonsBot({
    apiUrl: config.commonsApiUrl,
    userAgent: config.userAgent,
    credentials
  });
}

async function resolveWebCredentials(
  request: Request,
  response: Response,
  job: JobProgress
): Promise<BotCredentials | null> {
  if (isOAuthConfigured()) {
    const session = await getOAuthSession(request, response);
    return session
      ? { name: session.userName, botPassword: "", oauthAccessToken: session.accessToken }
      : null;
  }

  const loginName = resolveLoginName(job);
  const botPassword = await resolveBotPassword(loginName);
  return loginName && botPassword ? { name: loginName, botPassword } : null;
}

async function validateWriteRequest(request: Request, response: Response): Promise<boolean> {
  if (!isOAuthConfigured()) return true;
  const session = await getOAuthSession(request, response);
  const body = request.body as Record<string, unknown>;
  return Boolean(session && validateCsrfToken(session, body.csrfToken));
}

function buildHomeDefaults(body: Record<string, unknown>) {
  return {
    name: String(body.name ?? "").trim(),
    challenge: String(body.challenge ?? "").trim(),
    pairedChallenge: String(body.pairedChallenge ?? "").trim(),
    entryMode: String(body.entryMode ?? "single"),
    submissionStart: String(body.submissionStart ?? "").trim(),
    submissionEnd: String(body.submissionEnd ?? "").trim(),
    action: String(body.action ?? DEFAULT_JOB_ACTION),
    publishMode: String(body.publishMode ?? "dry-run")
  };
}

function buildPublishContext(
  accountName: string,
  mode: "sandbox" | "live",
  targetCount: number,
  t: Translator
) {
  return {
    accountName: accountName || t("common.unknown"),
    wikiLabel: t("common.wikimediaCommons"),
    modeLabel: t(`mode.${mode}`),
    targetCount,
    isLive: mode === "live"
  };
}

function buildWebPublishAuditContext(
  job: JobProgress,
  mode: "sandbox" | "live",
  credentials: BotCredentials
): PublishAuditContext {
  return {
    jobId: job.id,
    workflow: job.action,
    operator: credentials.name,
    oauthConsumer: credentials.oauthAccessToken ? config.oauth.clientId : null,
    mode
  };
}

function recordPublishAuthenticationFailure(
  job: JobProgress,
  mode: "sandbox" | "live",
  credentials: BotCredentials
): void {
  const auditContext = buildWebPublishAuditContext(job, mode, credentials);
  recordOperationalEvent({
    event: "publish.failure",
    outcome: "failure",
    ...auditContext,
    failureStage: "authentication"
  });
}
