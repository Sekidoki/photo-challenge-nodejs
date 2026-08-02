import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { config } from "../../src/infra/config.js";
import {
  beginOAuthLogin,
  clearOAuthSession,
  completeOAuthLogin,
  getOAuthSession,
  validateCsrfToken
} from "../../src/web/oauth-session.js";
import { test } from "../support/harness.js";

type CookieJar = Map<string, string>;

function fakeResponse(cookies: CookieJar): Response {
  const response = {
    cookie(name: string, value: string) {
      cookies.set(name, value);
      return response;
    },
    clearCookie(name: string) {
      cookies.delete(name);
      return response;
    }
  };
  return response as unknown as Response;
}

function fakeRequest(query: Record<string, string>, cookies: CookieJar): Request {
  return {
    query,
    headers: {
      cookie: [...cookies].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ")
    }
  } as unknown as Request;
}

test("OAuth session completes Authorization Code + PKCE without exposing tokens to the cookie", async () => {
  const previous = { ...config.oauth, allowedUsers: [...config.oauth.allowedUsers] };
  Object.assign(config.oauth, {
    clientId: "client-id",
    clientSecret: "client-secret",
    callbackUrl: "http://localhost:3000/auth/callback",
    sessionSecret: "01234567890123456789012345678901",
    authorizationUrl: "https://meta.example/oauth2/authorize",
    tokenUrl: "https://meta.example/oauth2/access_token",
    profileUrl: "https://meta.example/oauth2/resource/profile",
    allowedUsers: [],
    configured: true
  });

  try {
    const cookies: CookieJar = new Map();
    const response = fakeResponse(cookies);
    const authorizationUrl = new URL(beginOAuthLogin(response, "/jobs/example"));
    const state = authorizationUrl.searchParams.get("state");

    assert(state);
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert(authorizationUrl.searchParams.get("code_challenge"));
    assert(cookies.has("photo_challenge_oauth_state"));

    const fetchCalls: Array<{ url: string; authorization: string | null; body: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      fetchCalls.push({
        url,
        authorization: headers.get("Authorization"),
        body: init?.body instanceof URLSearchParams ? init.body.toString() : ""
      });
      if (url.endsWith("/access_token")) {
        return new globalThis.Response(JSON.stringify({
          access_token: "oauth-access-secret",
          refresh_token: "oauth-refresh-secret",
          expires_in: 3600
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new globalThis.Response(JSON.stringify({ username: "Example Maintainer" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const callbackRequest = fakeRequest({ state, code: "authorization-code" }, cookies);
    const returnTo = await completeOAuthLogin(callbackRequest, response, fetchImpl);
    assert.equal(returnTo, "/jobs/example");
    assert.match(fetchCalls[0]?.body ?? "", /code_verifier=/);
    assert.equal(fetchCalls[1]?.authorization, "Bearer oauth-access-secret");

    const sessionCookie = cookies.get("photo_challenge_session") ?? "";
    assert(sessionCookie);
    assert.equal(sessionCookie.includes("oauth-access-secret"), false);
    assert.equal(sessionCookie.includes("oauth-refresh-secret"), false);

    const sessionRequest = fakeRequest({}, cookies);
    const session = await getOAuthSession(sessionRequest, response, fetchImpl);
    assert(session);
    assert.equal(session.userName, "Example Maintainer");
    assert.equal(session.accessToken, "oauth-access-secret");
    assert.equal(validateCsrfToken(session, session.csrfToken), true);
    assert.equal(validateCsrfToken(session, "wrong-token"), false);

    clearOAuthSession(sessionRequest, response);
    assert.equal(await getOAuthSession(fakeRequest({}, cookies), response, fetchImpl), null);
  } finally {
    Object.assign(config.oauth, previous);
  }
});
