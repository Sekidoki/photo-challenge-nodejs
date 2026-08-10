import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const projectRoot = process.cwd();
const persistentDataRoot = resolvePersistentDataRoot(process.env, projectRoot);
const hostedRuntime = process.env.NODE_ENV === "production" || Boolean(process.env.TOOL_DATA_DIR);

export type WebAuthMode = "local" | "oauth";

export function resolveWebAuthMode(environment: NodeJS.ProcessEnv): WebAuthMode {
  const configuredMode = environment.WEB_AUTH_MODE?.trim().toLowerCase();
  if (configuredMode === "local" || configuredMode === "oauth") return configuredMode;
  if (configuredMode) {
    throw new Error('WEB_AUTH_MODE must be either "local" or "oauth".');
  }

  return environment.NODE_ENV === "production" || Boolean(environment.TOOL_DATA_DIR)
    ? "oauth"
    : "local";
}

export function resolvePersistentDataRoot(
  environment: { PHOTO_CHALLENGE_DATA_ROOT?: string; TOOL_DATA_DIR?: string },
  fallbackRoot: string
): string {
  const explicitRoot = environment.PHOTO_CHALLENGE_DATA_ROOT?.trim();
  if (explicitRoot) return explicitRoot;
  const toolDataDir = environment.TOOL_DATA_DIR?.trim();
  return toolDataDir ? path.join(toolDataDir, "photo-challenge-nodejs") : fallbackRoot;
}

const oauthClientId = process.env.WIKIMEDIA_OAUTH_CLIENT_ID?.trim() ?? "";
const oauthClientSecret = process.env.WIKIMEDIA_OAUTH_CLIENT_SECRET?.trim() ?? "";
const oauthCallbackUrl = process.env.WIKIMEDIA_OAUTH_CALLBACK_URL?.trim() ?? "";
const oauthSessionSecret = process.env.WEB_SESSION_SECRET?.trim() ?? "";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  webAuthMode: resolveWebAuthMode(process.env),
  hostedRuntime,
  projectRoot,
  outputRoot: path.join(persistentDataRoot, "output", "jobs"),
  commonsApiUrl: process.env.COMMONS_API_URL ?? "https://commons.wikimedia.org/w/api.php",
  userAgent:
    process.env.USER_AGENT ??
    "photo-challenge-nodejs/0.1.0 (local development; contact via Wikimedia Commons user page)",
  credentialServiceName: process.env.CREDENTIAL_SERVICE_NAME ?? "photo-challenge-nodejs/commons",
  accessControl: {
    ownerUserName: "Sekidoki",
    registryPath: path.join(persistentDataRoot, "output", "config", "maintainers.json")
  },
  oauth: {
    clientId: oauthClientId,
    clientSecret: oauthClientSecret,
    callbackUrl: oauthCallbackUrl,
    sessionSecret: oauthSessionSecret,
    authorizationUrl:
      process.env.WIKIMEDIA_OAUTH_AUTHORIZATION_URL
      ?? "https://meta.wikimedia.org/w/rest.php/oauth2/authorize",
    tokenUrl:
      process.env.WIKIMEDIA_OAUTH_TOKEN_URL
      ?? "https://meta.wikimedia.org/w/rest.php/oauth2/access_token",
    profileUrl:
      process.env.WIKIMEDIA_OAUTH_PROFILE_URL
      ?? "https://meta.wikimedia.org/w/rest.php/oauth2/resource/profile",
    configured: Boolean(
      oauthClientId
      && oauthClientSecret
      && oauthCallbackUrl
      && oauthSessionSecret.length >= 32
    )
  }
};

export function assertWebAuthConfiguration(): void {
  if (config.webAuthMode === "local") {
    if (config.hostedRuntime) {
      throw new Error("WEB_AUTH_MODE=local is restricted to local development and cannot run on Toolforge or in production.");
    }
    return;
  }
  if (!config.oauth.configured) {
    throw new Error(
      "WEB_AUTH_MODE=oauth requires WIKIMEDIA_OAUTH_CLIENT_ID, WIKIMEDIA_OAUTH_CLIENT_SECRET, "
      + "WIKIMEDIA_OAUTH_CALLBACK_URL, and a WEB_SESSION_SECRET of at least 32 characters."
    );
  }
}
