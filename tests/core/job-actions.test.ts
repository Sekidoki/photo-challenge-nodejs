import assert from "node:assert/strict";
import { test } from "../support/harness.js";
import {
  DEFAULT_JOB_ACTION,
  buildValidatedJobRequest,
  getJobActionLabel,
  isVoteCountingAction,
  parseEntryMode,
  parsePublishMode,
  parseSourcePageVariant,
  parseSubmissionWindowValues
} from "../../src/core/job-actions.js";

test("buildValidatedJobRequest builds typed job requests for the vote-counting workflow", () => {
  const request = buildValidatedJobRequest({
    action: DEFAULT_JOB_ACTION,
    challenge: "2026 - February - Orange",
    credentials: { name: "Example@Bot", botPassword: "secret" }
  });

  assert.equal(request.action, "count-votes-and-select-winners");
  assert.equal(request.challenge, "2026 - February - Orange");
  assert.equal(request.entryMode, "single");
  assert.equal(request.source, "old");
  assert.equal(request.publishMode, "dry-run");
});

test("buildValidatedJobRequest preserves an in-memory OAuth access token", () => {
  const request = buildValidatedJobRequest({
    action: DEFAULT_JOB_ACTION,
    challenge: "2026 - February - Orange",
    credentials: { name: "OAuth User", botPassword: "", oauthAccessToken: "short-lived-token" }
  });

  assert.equal(request.credentials.name, "OAuth User");
  assert.equal(request.credentials.botPassword, "");
  assert.equal(request.credentials.oauthAccessToken, "short-lived-token");
});

test("buildValidatedJobRequest rejects legacy process-challenge for new jobs", () => {
  assert.throws(
    () => buildValidatedJobRequest({
      action: "process-challenge",
      challenge: "2026 - February - Orange",
      credentials: { name: "Example@Bot", botPassword: "secret" }
    }),
    /Unknown command: process-challenge/
  );
});

test("shared validators reject invalid publish mode, entry mode, and source", () => {
  assert.throws(() => parsePublishMode("yolo"), /Invalid --publish-mode/);
  assert.throws(() => parseEntryMode("trio"), /Invalid --entry-mode/);
  assert.throws(() => parseSourcePageVariant("archive"), /Invalid --source/);
});

test("parseSubmissionWindowValues validates partial and reversed windows", () => {
  assert.throws(
    () => parseSubmissionWindowValues("2026-06-01T00:00:00Z", ""),
    /must be provided together/
  );
  assert.throws(
    () => parseSubmissionWindowValues("2026-07-01T00:00:00Z", "2026-06-01T00:00:00Z"),
    /start earlier than end/
  );
});

test("vote-counting metadata labels new and legacy actions consistently", () => {
  assert.equal(isVoteCountingAction("count-votes-and-select-winners"), true);
  assert.equal(isVoteCountingAction("process-challenge"), true);
  assert.equal(getJobActionLabel("process-challenge"), "Count votes and select winners");
});
