import assert from "node:assert/strict";
import { test } from "../support/harness.js";
import { isJobOwnedBy } from "../../src/web/job-access.js";

test("isJobOwnedBy permits only the job operator", () => {
  assert.equal(isJobOwnedBy("Example User", "Example User"), true);
  assert.equal(isJobOwnedBy("Example User", "Different User"), false);
  assert.equal(isJobOwnedBy("", "Example User"), false);
});

test("isJobOwnedBy follows Wikimedia user-name normalization", () => {
  assert.equal(isJobOwnedBy(" Example_User ", "example user"), true);
});
