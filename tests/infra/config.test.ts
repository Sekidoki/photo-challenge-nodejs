import assert from "node:assert/strict";
import path from "node:path";
import {
  assertWebAuthConfiguration,
  config,
  resolvePersistentDataRoot,
  resolveWebAuthMode
} from "../../src/infra/config.js";
import { test } from "../support/harness.js";

test("Toolforge persistent data root uses TOOL_DATA_DIR unless PHOTO_CHALLENGE_DATA_ROOT overrides it", () => {
  assert.equal(
    resolvePersistentDataRoot({ TOOL_DATA_DIR: "/data/project/example" }, "/app"),
    path.join("/data/project/example", "photo-challenge-nodejs")
  );
  assert.equal(
    resolvePersistentDataRoot({ TOOL_DATA_DIR: "/data/project/example", PHOTO_CHALLENGE_DATA_ROOT: "/custom/output" }, "/app"),
    "/custom/output"
  );
  assert.equal(resolvePersistentDataRoot({}, "/app"), "/app");
});

test("Web authentication defaults safely and validates explicit modes", () => {
  assert.equal(resolveWebAuthMode({}), "local");
  assert.equal(resolveWebAuthMode({ NODE_ENV: "production" }), "oauth");
  assert.equal(resolveWebAuthMode({ TOOL_DATA_DIR: "/data/project/example" }), "oauth");
  assert.equal(resolveWebAuthMode({ WEB_AUTH_MODE: "oauth" }), "oauth");
  assert.equal(resolveWebAuthMode({ WEB_AUTH_MODE: "LOCAL", NODE_ENV: "production" }), "local");
  assert.throws(() => resolveWebAuthMode({ WEB_AUTH_MODE: "automatic" }), /local.*oauth/);
});

test("OAuth Web mode fails closed when its secrets are incomplete", () => {
  const previousMode = config.webAuthMode;
  const previousHostedRuntime = config.hostedRuntime;
  const previousOAuth = { ...config.oauth };
  try {
    config.webAuthMode = "oauth";
    config.oauth.configured = false;
    assert.throws(() => assertWebAuthConfiguration(), /requires WIKIMEDIA_OAUTH_CLIENT_ID/);
    config.webAuthMode = "local";
    config.hostedRuntime = false;
    assert.doesNotThrow(() => assertWebAuthConfiguration());
    config.hostedRuntime = true;
    assert.throws(() => assertWebAuthConfiguration(), /restricted to local development/);
  } finally {
    config.webAuthMode = previousMode;
    config.hostedRuntime = previousHostedRuntime;
    Object.assign(config.oauth, previousOAuth);
  }
});
