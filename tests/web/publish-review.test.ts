import assert from "node:assert/strict";
import { test } from "../support/harness.js";
import { buildPublishableArtifacts, summarizePublishDiff } from "../../src/web/publish-review.js";
import { buildStandardPublishReview, toStandardPublishPlan } from "../../src/web/standard-publish-review.js";
import type { JobProgress } from "../../src/core/models.js";

const baseJob: JobProgress = {
  id: "job-1",
  status: "completed",
  currentStep: "Completed",
  percent: 100,
  startedAt: null,
  finishedAt: null,
  messages: [],
  outputDir: "output/jobs/job-1",
  action: "count-votes-and-select-winners",
  challenge: "2026 - February - Orange",
  publishMode: "dry-run",
  loginName: "Example@BotApp",
  errorMessage: null
};

test("buildPublishableArtifacts prefers revised voting output for vote-counting publishes", () => {
  const artifacts = buildPublishableArtifacts(baseJob, [
    { name: "2026_-_February_-_Orange_voting.txt", content: "draft voting" },
    { name: "2026_-_February_-_Orange_revised.txt", content: "revised voting" },
    { name: "2026_-_February_-_Orange_result.txt", content: "result" },
    { name: "2026_-_February_-_Orange_winners.txt", content: "winners" }
  ], "sandbox");

  assert.deepEqual(artifacts.map((artifact) => artifact.fileName).sort(), [
    "2026_-_February_-_Orange_result.txt",
    "2026_-_February_-_Orange_revised.txt",
    "2026_-_February_-_Orange_winners.txt"
  ]);
  assert.equal(artifacts.find((artifact) => artifact.type === "revised")?.targetTitle, "User:Example/Sandbox/2026 - February - Orange/Voting");
});

test("buildStandardPublishReview builds review entries without live diffs when no bot is available", async () => {
  const review = await buildStandardPublishReview(baseJob, "sandbox", "Example@BotApp", null, [
    { name: "2026_-_February_-_Orange_revised.txt", content: "revised voting" },
    { name: "2026_-_February_-_Orange_result.txt", content: "result" },
    { name: "2026_-_February_-_Orange_winners.txt", content: "winners" }
  ]);

  assert.equal(review.entries.length, 3);
  assert.equal(review.entries.every((entry) => entry.status === "unknown" && entry.isSingleColumn), true);
  assert.equal(review.entries.some((entry) => /does not exist/.test(entry.summary)), false);
  assert.match(review.warning ?? "", /saved BotPassword/);
});

test("toStandardPublishPlan chooses vote-counting publish summaries", () => {
  const artifact = buildPublishableArtifacts(baseJob, [
    { name: "2026_-_February_-_Orange_revised.txt", content: "revised voting" }
  ], "sandbox")[0];
  assert(artifact);

  const plan = toStandardPublishPlan(baseJob, artifact);

  assert.equal(plan.targetTitle, "User:Example/Sandbox/2026 - February - Orange/Voting");
  assert.equal(plan.editSummary, "Photo Challenge bot: revise voting page after validation");
});

test("summarizePublishDiff reports new pages and changed first line", () => {
  const newPage = summarizePublishDiff(null, "alpha\nbeta");
  assert.equal(newPage.status, "new");
  assert.equal(newPage.nextLineCount, 2);

  const changed = summarizePublishDiff("alpha\nold\nomega", "alpha\nnew\nomega");
  assert.equal(changed.status, "changed");
  assert.equal(changed.firstDifferenceLine, 2);
  assert.equal(changed.changedLineCount, 1);
});

test("summarizePublishDiff builds row-level add/remove/change markers", () => {
  const diff = summarizePublishDiff("alpha\nbeta\ngamma", "alpha\nBETA\ndelta\ngamma");
  const rowKinds = diff.rows.filter((row) => !row.isSkip).map((row) => row.kind);

  assert.deepEqual(rowKinds, ["same", "change", "add", "same"]);
  assert.equal(diff.rows.find((row) => row.kind === "add")?.nextText, "delta");
});

test("summarizePublishDiff collapses long unchanged spans into skip rows", () => {
  const current = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join("\n");
  const next = current.replace("line-7", "line-seven");
  const diff = summarizePublishDiff(current, next);

  assert.equal(diff.rows.some((row) => row.isSkip), true);
  assert.equal(diff.rows.some((row) => row.kind === "change"), true);
});
