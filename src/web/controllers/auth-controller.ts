import type { Request, Response } from "express";
import {
  beginOAuthLogin,
  clearOAuthSession,
  completeOAuthLogin,
  getOAuthConfigurationMessage,
  getOAuthSession,
  validateCsrfToken
} from "../oauth-session.js";
import { createTranslator, getRequestLocale } from "../i18n.js";

export function startOAuthLogin(request: Request, response: Response): void {
  const configurationError = getOAuthConfigurationMessage();
  if (configurationError) {
    response.redirect(`/?authError=${encodeURIComponent(configurationError)}`);
    return;
  }

  const returnTo = typeof request.query.returnTo === "string" ? request.query.returnTo : "/";
  response.redirect(beginOAuthLogin(response, returnTo));
}

export async function finishOAuthLogin(request: Request, response: Response): Promise<void> {
  const t = createTranslator(getRequestLocale(request));
  try {
    const returnTo = await completeOAuthLogin(request, response);
    response.redirect(returnTo);
  } catch (error) {
    const message = error instanceof Error ? error.message : t("auth.failed");
    response.redirect(`/?authError=${encodeURIComponent(message)}`);
  }
}

export async function logoutOAuthSession(request: Request, response: Response): Promise<void> {
  const t = createTranslator(getRequestLocale(request));
  const session = await getOAuthSession(request, response);
  const body = request.body as Record<string, unknown>;
  if (!session || !validateCsrfToken(session, body.csrfToken)) {
    response.status(403).send(t("auth.invalidSignOut"));
    return;
  }

  clearOAuthSession(request, response);
  response.redirect("/?signedOut=1");
}
