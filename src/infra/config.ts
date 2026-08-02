import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const projectRoot = process.cwd();
const persistentDataRoot = resolvePersistentDataRoot(process.env, projectRoot);

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
