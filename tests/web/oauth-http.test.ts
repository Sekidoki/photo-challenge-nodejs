import assert from "node:assert/strict";
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
  const previous = { ...config.oauth, allowedUsers: [...config.oauth.allowedUsers] };
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
    allowedUsers: [],
    configured: true
  });
  globalThis.fetch = oauthFetch;

  try {
    server = await listen(createApp().listen(0, "127.0.0.1"));
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    if (server) await close(server);
    globalThis.fetch = originalFetch;
    Object.assign(config.oauth, previous);
  }
}

function createOAuthFetch(options: { expiresIn?: number } = {}): typeof fetch & { calls: OAuthFetchCall[] } {
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

    return new globalThis.Response(JSON.stringify({ username: "HTTP Maintainer" }), {
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
