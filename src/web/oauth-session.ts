import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../infra/config.js";
import { recordOperationalEvent } from "../infra/operational-events.js";
import { getMaintainerRole, type MaintainerRole } from "../infra/maintainer-registry.js";

const sessionCookieName = "photo_challenge_session";
const loginStateCookieName = "photo_challenge_oauth_state";
const loginStateLifetimeMs = 10 * 60 * 1000;
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const refreshSkewMs = 60 * 1000;

type PendingLogin = {
  codeVerifier: string;
  returnTo: string;
  expiresAt: number;
};

type StoredOAuthSession = {
  id: string;
  userName: string;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: number;
  expiresAt: number;
  csrfToken: string;
};

export type OAuthSession = Pick<StoredOAuthSession, "userName" | "accessToken" | "csrfToken" | "expiresAt"> & {
  role: MaintainerRole;
};

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
};

const pendingLogins = new Map<string, PendingLogin>();
const sessions = new Map<string, StoredOAuthSession>();

export function isOAuthConfigured(): boolean {
  return config.webAuthMode === "oauth" && config.oauth.configured;
}

export function getOAuthConfigurationMessage(): string | null {
  if (config.webAuthMode === "local") {
    return null;
  }
  if (isOAuthConfigured()) {
    return null;
  }

  return "Wikimedia OAuth is not configured. Set WIKIMEDIA_OAUTH_CLIENT_ID, WIKIMEDIA_OAUTH_CLIENT_SECRET, WIKIMEDIA_OAUTH_CALLBACK_URL, and a WEB_SESSION_SECRET of at least 32 characters.";
}

export function beginOAuthLogin(response: Response, returnTo = "/"): string {
  assertOAuthConfigured();
  pruneExpiredRecords();

  const state = randomToken();
  const codeVerifier = randomToken(48);
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  pendingLogins.set(state, {
    codeVerifier,
    returnTo: normalizeReturnTo(returnTo),
    expiresAt: Date.now() + loginStateLifetimeMs
  });

  response.cookie(loginStateCookieName, signValue(state), cookieOptions(loginStateLifetimeMs));

  const authorizationUrl = new URL(config.oauth.authorizationUrl);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", config.oauth.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.oauth.callbackUrl);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  return authorizationUrl.toString();
}

export async function completeOAuthLogin(
  request: Request,
  response: Response,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  assertOAuthConfigured();
  pruneExpiredRecords();

  const state = getSingleQueryValue(request.query.state);
  const code = getSingleQueryValue(request.query.code);
  const cookieState = readSignedCookie(request, loginStateCookieName);
  const pending = state ? pendingLogins.get(state) : null;

  response.clearCookie(loginStateCookieName, cookieOptions());
  if (!state || !code || cookieState !== state || !pending || pending.expiresAt <= Date.now()) {
    if (state) pendingLogins.delete(state);
    throw new Error("The Wikimedia sign-in request expired or could not be verified. Please try again.");
  }
  pendingLogins.delete(state);

  const token = await requestToken(fetchImpl, new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.oauth.clientId,
    client_secret: config.oauth.clientSecret,
    redirect_uri: config.oauth.callbackUrl,
    code,
    code_verifier: pending.codeVerifier
  }));
  const profile = await requestProfile(fetchImpl, token.accessToken);
  const role = await getMaintainerRole(profile.userName);
  if (!role) {
    throw new Error(`Wikimedia user ${profile.userName} is not allowed to maintain this tool.`);
  }

  const id = randomToken();
  sessions.set(id, {
    id,
    userName: profile.userName,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    accessTokenExpiresAt: Date.now() + token.expiresInSeconds * 1000,
    expiresAt: Date.now() + sessionLifetimeMs,
    csrfToken: randomToken()
  });
  response.cookie(sessionCookieName, signValue(id), cookieOptions(sessionLifetimeMs));
  return pending.returnTo;
}

export async function getOAuthSession(
  request: Request,
  response?: Response,
  fetchImpl: typeof fetch = fetch
): Promise<OAuthSession | null> {
  if (!isOAuthConfigured()) {
    return null;
  }

  pruneExpiredRecords();
  const sessionId = readSignedCookie(request, sessionCookieName);
  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    response?.clearCookie(sessionCookieName, cookieOptions());
    return null;
  }

  const role = await getMaintainerRole(session.userName);
  if (!role) {
    sessions.delete(sessionId);
    response?.clearCookie(sessionCookieName, cookieOptions());
    return null;
  }

  if (session.accessTokenExpiresAt <= Date.now() + refreshSkewMs) {
    if (!session.refreshToken) {
      sessions.delete(sessionId);
      response?.clearCookie(sessionCookieName, cookieOptions());
      return null;
    }

    try {
      const token = await requestToken(fetchImpl, new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.oauth.clientId,
        client_secret: config.oauth.clientSecret,
        refresh_token: session.refreshToken
      }));
      session.accessToken = token.accessToken;
      session.refreshToken = token.refreshToken ?? session.refreshToken;
      session.accessTokenExpiresAt = Date.now() + token.expiresInSeconds * 1000;
    } catch {
      recordOperationalEvent({
        event: "oauth.refresh.failure",
        outcome: "failure",
        operator: session.userName,
        oauthConsumer: config.oauth.clientId,
        failureStage: "refresh"
      });
      sessions.delete(sessionId);
      response?.clearCookie(sessionCookieName, cookieOptions());
      return null;
    }
  }

  return toPublicSession(session, role);
}

export function clearOAuthSession(request: Request, response: Response): void {
  const sessionId = readSignedCookie(request, sessionCookieName);
  if (sessionId) {
    sessions.delete(sessionId);
  }
  response.clearCookie(sessionCookieName, cookieOptions());
}

export function validateCsrfToken(session: OAuthSession, submittedToken: unknown): boolean {
  const token = typeof submittedToken === "string" ? submittedToken : "";
  return constantTimeEqual(session.csrfToken, token);
}

function assertOAuthConfigured(): void {
  if (config.webAuthMode !== "oauth") {
    throw new Error("Wikimedia OAuth is disabled because WEB_AUTH_MODE=local.");
  }
  const message = getOAuthConfigurationMessage();
  if (message) throw new Error(message);
}

async function requestToken(fetchImpl: typeof fetch, body: URLSearchParams) {
  const response = await fetchImpl(config.oauth.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": config.userAgent
    },
    body
  });
  const payload = await readJson<TokenResponse>(response);
  if (!response.ok || typeof payload.access_token !== "string") {
    const detail = typeof payload.error_description === "string"
      ? payload.error_description
      : typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(`Wikimedia OAuth token exchange failed: ${detail}`);
  }

  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expiresInSeconds: parseExpiresIn(payload.expires_in)
  };
}

function parseExpiresIn(value: unknown): number {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
}

async function requestProfile(fetchImpl: typeof fetch, accessToken: string) {
  const response = await fetchImpl(config.oauth.profileUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": config.userAgent
    }
  });
  const payload = await readJson<{ username?: unknown; error?: unknown }>(response);
  if (response.ok && typeof payload.username === "string" && payload.username.trim()) {
    return { userName: payload.username.trim() };
  }

  return requestCommonsUserInfo(
    fetchImpl,
    accessToken,
    describeResourceFailure(response, payload, "missing username")
  );
}

async function requestCommonsUserInfo(
  fetchImpl: typeof fetch,
  accessToken: string,
  metaFailure: string
) {
  const url = new URL(config.commonsApiUrl);
  url.searchParams.set("action", "query");
  url.searchParams.set("meta", "userinfo");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": config.userAgent
    }
  });
  const payload = await readJson<{
    error?: { code?: unknown };
    query?: { userinfo?: { name?: unknown; anon?: unknown } };
  }>(response);
  const userInfo = payload.query?.userinfo;
  if (
    !response.ok
    || !userInfo
    || userInfo.anon !== undefined
    || typeof userInfo.name !== "string"
    || !userInfo.name.trim()
  ) {
    const commonsReason = userInfo?.anon !== undefined
      ? "anonymous user"
      : describeResourceFailure(response, payload.error, "missing userinfo name");
    throw new Error(
      `Wikimedia OAuth could not identify the signed-in user (Meta: ${metaFailure}; Commons: ${commonsReason}).`
    );
  }
  return { userName: userInfo.name.trim() };
}

function describeResourceFailure(
  response: globalThis.Response,
  payload: { error?: unknown; code?: unknown } | undefined,
  fallback: string
): string {
  const rawCode = payload?.error ?? payload?.code;
  const code = typeof rawCode === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(rawCode)
    ? rawCode
    : fallback;
  return `HTTP ${response.status} ${code}`;
}

async function readJson<T>(response: globalThis.Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    return {} as T;
  }
}

function pruneExpiredRecords(): void {
  const now = Date.now();
  for (const [state, pending] of pendingLogins) {
    if (pending.expiresAt <= now) pendingLogins.delete(state);
  }
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

function normalizeReturnTo(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function getSingleQueryValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.oauth.callbackUrl.startsWith("https://"),
    path: "/",
    ...(maxAge === undefined ? {} : { maxAge })
  };
}

function readSignedCookie(request: Request, name: string): string | null {
  const header = request.headers.cookie ?? "";
  const rawValue = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!rawValue) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawValue);
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf(".");
  if (separator < 1) return null;
  const value = decoded.slice(0, separator);
  const signature = decoded.slice(separator + 1);
  return constantTimeEqual(sign(value), signature) ? value : null;
}

function signValue(value: string): string {
  return `${value}.${sign(value)}`;
}

function sign(value: string): string {
  return createHmac("sha256", config.oauth.sessionSecret).update(value).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function toPublicSession(session: StoredOAuthSession, role: MaintainerRole): OAuthSession {
  return {
    userName: session.userName,
    accessToken: session.accessToken,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    role
  };
}
