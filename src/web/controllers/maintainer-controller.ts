import type { Request, Response } from "express";
import {
  canManageMaintainers,
  listMaintainers,
  removeMaintainer,
  upsertMaintainer,
  type MaintainerRole
} from "../../infra/maintainer-registry.js";
import { createTranslator, getRequestLocale, type Translator } from "../i18n.js";
import { getOAuthSession, isOAuthConfigured, validateCsrfToken } from "../oauth-session.js";

export async function renderMaintainersPage(request: Request, response: Response): Promise<void> {
  if (!isOAuthConfigured()) {
    response.status(404).send("Not found");
    return;
  }

  const session = await getOAuthSession(request, response);
  if (!session) {
    response.redirect("/auth/login?returnTo=%2Fmaintainers");
    return;
  }

  const locale = getRequestLocale(request);
  const t = createTranslator(locale);
  const success = request.query.updated === "1"
    ? t("maintainers.success.updated")
    : request.query.removed === "1" ? t("maintainers.success.removed") : undefined;

  await renderPage(response, session.userName, session.role, session.csrfToken, t, {
    success,
    status: canManageMaintainers(session.role) ? 200 : 403,
    error: canManageMaintainers(session.role) ? undefined : t("maintainers.error.forbidden")
  });
}

export async function addOrUpdateMaintainer(request: Request, response: Response): Promise<void> {
  const context = await requireManagerRequest(request, response);
  if (!context) return;

  const body = request.body as Record<string, unknown>;
  const requestedRole = body.role === "manager" ? "manager" : "maintainer";
  const requestedUserName = String(body.userName ?? "").trim();
  if (!requestedUserName) {
    await renderPage(response, context.userName, context.role, context.csrfToken, context.t, {
      status: 400, error: context.t("maintainers.error.userNameRequired"), fieldError: context.t("maintainers.error.userNameRequired"), formUserName: ""
    });
    return;
  }
  try {
    await upsertMaintainer(context.userName, requestedUserName, requestedRole);
    response.redirect("/maintainers?updated=1");
  } catch (error) {
    await renderPage(response, context.userName, context.role, context.csrfToken, context.t, {
      status: 400,
      error: error instanceof Error ? error.message : context.t("maintainers.error.updateFailed"),
      fieldError: error instanceof Error ? error.message : context.t("maintainers.error.updateFailed"),
      formUserName: requestedUserName
    });
  }
}

export async function removeMaintainerAction(request: Request, response: Response): Promise<void> {
  const context = await requireManagerRequest(request, response);
  if (!context) return;

  const body = request.body as Record<string, unknown>;
  try {
    await removeMaintainer(context.userName, String(body.userName ?? ""));
    response.redirect("/maintainers?removed=1");
  } catch (error) {
    await renderPage(response, context.userName, context.role, context.csrfToken, context.t, {
      status: 400,
      error: error instanceof Error ? error.message : context.t("maintainers.error.removeFailed")
    });
  }
}

async function requireManagerRequest(request: Request, response: Response) {
  if (!isOAuthConfigured()) {
    response.status(404).send("Not found");
    return null;
  }

  const session = await getOAuthSession(request, response);
  const t = createTranslator(getRequestLocale(request));
  if (!session) {
    response.status(401).send(t("maintainers.error.signIn"));
    return null;
  }
  if (!validateCsrfToken(session, (request.body as Record<string, unknown>).csrfToken)) {
    response.status(403).send(t("maintainers.error.invalidRequest"));
    return null;
  }
  if (!canManageMaintainers(session.role)) {
    response.status(403).send(t("maintainers.error.forbidden"));
    return null;
  }

  return { userName: session.userName, role: session.role, csrfToken: session.csrfToken, t };
}

async function renderPage(
  response: Response,
  actorUserName: string,
  actorRole: MaintainerRole,
  csrfToken: string,
  t: Translator,
  options: { status: number; error?: string; success?: string; fieldError?: string; formUserName?: string }
): Promise<void> {
  const maintainers = canManageMaintainers(actorRole) ? await listMaintainers() : [];
  response.status(options.status).render("maintainers", {
    title: t("maintainers.title"),
    error: options.error,
    fieldError: options.fieldError,
    formUserName: options.formUserName ?? "",
    success: options.success,
    actor: {
      userName: actorUserName,
      role: actorRole,
      isOwner: actorRole === "owner"
    },
    csrfToken,
    maintainers: maintainers.map((maintainer) => ({
      ...maintainer,
      roleLabel: t(`maintainers.role.${maintainer.role}`),
      isOwner: maintainer.role === "owner",
      isManager: maintainer.role === "manager",
      canEdit: actorRole === "owner" && maintainer.role !== "owner",
      canRemove:
        maintainer.role !== "owner"
        && (actorRole === "owner" || maintainer.role === "maintainer")
    }))
  });
}
