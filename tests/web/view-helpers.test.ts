import assert from "node:assert/strict";
import { createFlash, readFlash } from "../../src/web/flash.js";
import { createTranslator } from "../../src/web/i18n.js";
import { buildRetryUrl, buildWorkflowSteps, failureHint, translateStep } from "../../src/web/view-helpers.js";
import { test } from "../support/harness.js";

test("translateStep localizes known and patterned workflow steps", () => {
  const t = createTranslator("zh-TW");
  assert.equal(translateStep("Completed", t), "已完成");
  assert.equal(translateStep("Reading submission page", t), "讀取 submission page");
  assert.equal(translateStep("Some future step", t), "Some future step");
});

test("buildWorkflowSteps marks completed, current and failed stages", () => {
  const t = createTranslator("en");
  const failed = buildWorkflowSteps("run", t, true);
  assert.deepEqual(failed.map((step) => [step.isComplete, step.isCurrent, step.isFailed]), [
    [true, false, false],
    [false, false, true],
    [false, false, false],
    [false, false, false]
  ]);
  assert.equal(failed[1]?.suffix, "(failed)");
  assert.equal(buildWorkflowSteps("review", t).filter((step) => step.isComplete).length, 2);
});

test("failureHint distinguishes missing pages from sign-in failures", () => {
  const t = createTranslator("en");
  assert.match(failureHint("Submission page Commons:Photo challenge/X not found", t), /spelling of the challenge name/);
  assert.match(failureHint("Login failed: WrongPass", t), /Sign-in failed/);
  assert.match(failureHint(null, t), /adjust the settings/);
});

test("buildRetryUrl never pre-selects live mode", () => {
  assert.equal(buildRetryUrl({ action: "create-voting", challenge: "2025 - May - Doors", publishMode: "sandbox" }), "/?action=create-voting&challenge=2025+-+May+-+Doors&publishMode=sandbox");
  assert.doesNotMatch(buildRetryUrl({ action: "create-voting", challenge: "X", publishMode: "live" }), /publishMode/);
});

test("flash notices are only readable by their server-issued id", () => {
  const id = createFlash("Published 3 pages.", { links: [{ title: "Commons:Photo challenge", url: "https://commons.wikimedia.org/wiki/Commons:Photo_challenge" }] });
  assert.equal(readFlash(id)?.message, "Published 3 pages.");
  assert.equal(readFlash(id)?.links.length, 1);
  assert.equal(readFlash("Published to live pages (forged)"), null);
  assert.equal(readFlash(undefined), null);
});
