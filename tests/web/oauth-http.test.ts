import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { config } from "../../src/infra/config.js";
import { createApp } from "../../src/web/app.js";
import { test } from "../support/harness.js";

type CookieJar = Map<string, string>;
type OAuthFetchCall = { url: string; body: string };

const originalFetch = globalThis.fetch;

async function withOAuthHttpServer(
  oauthFetch: typeof fetch,
  run: (baseUrl: string, calls: OAuthFetchCall[]) => Promise<void>
): Promise<void> {
  const previous = { ...config.oauth };
  const previousRegistryPath = config.accessControl.registryPath;
  const registryDirectory = await mkdtemp(path.join(tmpdir(), "photo-challenge-http-maintainers-"));
  const calls = (oauthFetch as typeof oauthFetch & { calls?: OAuthFetchCall[] }).calls ?? [];
  let server: Server | null = null;

  Object.assign(config.oauth, {
    clientId: "http-test-consumer",
    clientSecret: "http-test-secret",
    callbackUrl: "http://127.0.0.1/auth/callback",
    sessionSecret: "01234567890123456789012345678901",
    authorizationUrl: "https://meta.example/oauth2/authorize",
    tokenUrl: "https://meta.example/oauth2/access_token",
    profileUrl: "https://meta.example/oauth2/resource/profile",
    configured: true
  });
  config.accessControl.registryPath = path.join(registryDirectory, "maintainers.json");
  globalThis.fetch = oauthFetch;

  try {
    server = await listen(createApp().listen(0, "127.0.0.1"));
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    if (server) await close(server);
    globalThis.fetch = originalFetch;
    Object.assign(config.oauth, previous);
    config.accessControl.registryPath = previousRegistryPath;
    await rm(registryDirectory, { recursive: true, force: true });
  }
}

function createOAuthFetch(options: { expiresIn?: number; userName?: string } = {}): typeof fetch & { calls: OAuthFetchCall[] } {
  const calls: OAuthFetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : "";
    calls.push({ url, body });

    if (url.endsWith("/access_token")) {
      const isRefresh = new URLSearchParams(body).get("grant_type") === "refresh_token";
      return new globalThis.Response(JSON.stringify({
        access_token: isRefresh ? "refreshed-access-token" : "initial-access-token",
        refresh_token: isRefresh ? "refreshed-refresh-token" : "initial-refresh-token",
        expires_in: options.expiresIn ?? 3600
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new globalThis.Response(JSON.stringify({ username: options.userName ?? "Sekidoki" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  return Object.assign(fetchImpl, { calls });
}

async function completeLogin(baseUrl: string, cookies: CookieJar): Promise<Response> {
  const login = await request(baseUrl, "/auth/login?returnTo=%2Fhealthz", cookies);
  assert.equal(login.status, 302);
  const authorizationUrl = new URL(login.headers.get("location") ?? "");
  const state = authorizationUrl.searchParams.get("state");
  assert(state);

  return request(baseUrl, `/auth/callback?state=${encodeURIComponent(state)}&code=http-code`, cookies);
}

test("OAuth HTTP callback establishes an opaque session and returns to the requested route", async () => {
  const oauthFetch = createOAuthFetch();
  await withOAuthHttpServer(oauthFetch, async (baseUrl, calls) => {
    const cookies: CookieJar = new Map();
    const callback = await completeLogin(baseUrl, cookies);

    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), "/healthz");
    const sessionCookie = cookies.get("photo_challenge_session") ?? "";
    assert(sessionCookie);
    assert.equal(sessionCookie.includes("initial-access-token"), false);
    assert.equal(sessionCookie.includes("initial-refresh-token"), false);
    assert.equal(calls.some((call) => call.url.endsWith("/resource/profile")), true);

    const health = await request(baseUrl, "/healthz", cookies);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok");
  });
});

test("OAuth HTTP routes reject an invalid CSRF token without clearing the valid session", async () => {
  await withOAuthHttpServer(createOAuthFetch(), async (baseUrl) => {
    const cookies: CookieJar = new Map();
    await completeLogin(baseUrl, cookies);

    const logout = await request(baseUrl, "/auth/logout", cookies, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "csrfToken=wrong-token"
    });

    assert.equal(logout.status, 403);
    assert.match(await logout.text(), /Invalid or expired sign-out request/);
    assert(cookies.has("photo_challenge_session"));
  });
});

test("OAuth HTTP middleware refreshes an expiring access token before serving a request", async () => {
  const oauthFetch = createOAuthFetch({ expiresIn: 1 });
  await withOAuthHttpServer(oauthFetch, async (baseUrl, calls) => {
    const cookies: CookieJar = new Map();
    await completeLogin(baseUrl, cookies);

    const health = await request(baseUrl, "/healthz", cookies);
    assert.equal(health.status, 200);

    const tokenBodies = calls
      .filter((call) => call.url.endsWith("/access_token"))
      .map((call) => new URLSearchParams(call.body).get("grant_type"));
    assert.deepEqual(tokenBodies, ["authorization_code", "refresh_token"]);
  });
});

test("OAuth HTTP callback failures emit a sanitized operational event", async () => {
  await withOAuthHttpServer(createOAuthFetch(), async (baseUrl) => {
    const cookies: CookieJar = new Map();
    const records: string[] = [];
    const previousConsoleError = console.error;
    console.error = (message?: unknown) => records.push(String(message));

    try {
      const callback = await request(
        baseUrl,
        "/auth/callback?state=invalid-state&code=secret-authorization-code",
        cookies
      );
      assert.equal(callback.status, 302);
      assert.match(callback.headers.get("location") ?? "", /^\/?\?authError=/);
    } finally {
      console.error = previousConsoleError;
    }

    assert.equal(records.length, 1);
    const event = JSON.parse(records[0]) as Record<string, unknown>;
    assert.equal(event.event, "oauth.login.failure");
    assert.equal(event.failureStage, "callback");
    assert.equal(records[0].includes("secret-authorization-code"), false);
    assert.equal(records[0].includes("User-Agent"), false);
    assert.equal(records[0].includes("127.0.0.1"), false);
  });
});

test("OAuth HTTP routes require an authorized maintainer before exposing job data", async () => {
  await withOAuthHttpServer(createOAuthFetch(), async (baseUrl) => {
    const response = await request(baseUrl, "/jobs/example", new Map());
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") ?? "", /^\/auth\/login\?returnTo=/);
  });
});

test("OAuth HTTP callback fails closed for users outside the maintainer registry", async () => {
  await withOAuthHttpServer(createOAuthFetch({ userName: "Not Authorized" }), async (baseUrl) => {
    const cookies: CookieJar = new Map();
    const callback = await completeLogin(baseUrl, cookies);
    assert.equal(callback.status, 302);
    assert.match(callback.headers.get("location") ?? "", /authError=/);
    assert.equal(cookies.has("photo_challenge_session"), false);
  });
});

test("protected owner manages the persistent maintainer list from the Web UI", async () => {
  const oauthOptions: { userName?: string } = { userName: "Sekidoki" };
  await withOAuthHttpServer(createOAuthFetch(oauthOptions), async (baseUrl) => {
    const cookies: CookieJar = new Map();
    await completeLogin(baseUrl, cookies);

    const page = await request(baseUrl, "/maintainers", cookies);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Sekidoki/);
    assert.match(html, /Protected owner/);
    const csrfToken = html.match(/name="csrfToken" value="([^"]+)"/)?.[1];
    assert(csrfToken);

    const add = await request(baseUrl, "/maintainers", cookies, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, userName: "Second Maintainer", role: "manager" }).toString()
    });
    assert.equal(add.status, 302);
    assert.equal(add.headers.get("location"), "/maintainers?updated=1");

    const updated = await request(baseUrl, "/maintainers", cookies);
    assert.match(await updated.text(), /Second Maintainer/);

    oauthOptions.userName = "Second Maintainer";
    const managerCookies: CookieJar = new Map();
    const managerCallback = await completeLogin(baseUrl, managerCookies);
    assert.equal(managerCallback.status, 302);
    assert.equal((await request(baseUrl, "/maintainers", managerCookies)).status, 200);

    const removeManager = await request(baseUrl, "/maintainers/remove", cookies, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, userName: "Second Maintainer" }).toString()
    });
    assert.equal(removeManager.status, 302);
    const revokedSession = await request(baseUrl, "/maintainers", managerCookies);
    assert.equal(revokedSession.status, 302);
    assert.match(revokedSession.headers.get("location") ?? "", /^\/auth\/login/);

    const removeOwner = await request(baseUrl, "/maintainers/remove", cookies, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, userName: "Sekidoki" }).toString()
    });
    assert.equal(removeOwner.status, 400);
    assert.match(await removeOwner.text(), /protected owner/);
  });
});

test("maintainer management rejects invalid CSRF tokens", async () => {
  await withOAuthHttpServer(createOAuthFetch(), async (baseUrl) => {
    const cookies: CookieJar = new Map();
    await completeLogin(baseUrl, cookies);
    const response = await request(baseUrl, "/maintainers", cookies, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "csrfToken=wrong&userName=Unexpected&role=maintainer"
    });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /invalid or expired/i);
  });
});

async function request(
  baseUrl: string,
  route: string,
  cookies: CookieJar,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookie) headers.set("Cookie", cookie);

  const response = await originalFetch(`${baseUrl}${route}`, {
    ...init,
    headers,
    redirect: "manual"
  });
  updateCookies(cookies, response.headers);
  return response;
}

function updateCookies(cookies: CookieJar, headers: Headers): void {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = getSetCookie ? getSetCookie.call(headers) : [headers.get("set-cookie") ?? ""].filter(Boolean);

  for (const value of values) {
    const [pair] = value.split(";", 1);
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator);
    const cookieValue = pair.slice(separator + 1);
    if (/Max-Age=0/i.test(value) || cookieValue === "") cookies.delete(name);
    else cookies.set(name, cookieValue);
  }
}

function listen(server: Server): Promise<Server> {
  if (server.listening) return Promise.resolve(server);
  return new Promise((resolve, reject) => {
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
