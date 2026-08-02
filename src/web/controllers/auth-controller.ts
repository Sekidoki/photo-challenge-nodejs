import type { Request, Response } from "express";
import {
  beginOAuthLogin,
  clearOAuthSession,
  completeOAuthLogin,
  getOAuthConfigurationMessage,
  getOAuthSession,
  validateCsrfToken
} from "../oauth-session.js";

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
  try {
    const returnTo = await completeOAuthLogin(request, response);
    response.redirect(returnTo);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wikimedia sign-in failed.";
    response.redirect(`/?authError=${encodeURIComponent(message)}`);
  }
}

export async function logoutOAuthSession(request: Request, response: Response): Promise<void> {
  const session = await getOAuthSession(request, response);
  const body = request.body as Record<string, unknown>;
  if (!session || !validateCsrfToken(session, body.csrfToken)) {
    response.status(403).send("Invalid or expired sign-out request.");
    return;
  }

  clearOAuthSession(request, response);
  response.redirect("/?signedOut=1");
}
