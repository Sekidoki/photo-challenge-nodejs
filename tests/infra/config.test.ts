import assert from "node:assert/strict";
import path from "node:path";
import { resolvePersistentDataRoot } from "../../src/infra/config.js";
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
