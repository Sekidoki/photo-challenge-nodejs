import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "../support/harness.js";
import { getJobOutputPaths } from "../../src/infra/output-paths.js";
import { prependSandboxSpeedyDeletionTemplate } from "../../src/workflows/job-runner-support.js";
import { buildMaintenancePublishEntries } from "../../src/workflows/maintenance-publish.js";
import { publishMaintenanceEditPlans, publishStandardPages, readExistingPageContent } from "../../src/workflows/publish-service.js";
import type { CommonsBot, ReadPageResult, SavePageResult } from "../../src/services/commons-bot.js";

function makeFakeBot(pages: Map<string, string>) {
  const saves: Array<{ title: string; text: string; summary: string }> = [];
  const bot: CommonsBot = {
    async readPage(title: string): Promise<ReadPageResult> {
      const content = pages.get(title);
      if (content === undefined) {
        throw new Error(`Page does not exist: ${title}`);
      }
      return { title, content, revisionTimestamp: null, revisionId: null };
    },
    async savePage(title: string, text: string, summary: string): Promise<SavePageResult> {
      saves.push({ title, text, summary });
      pages.set(title, text);
      return { title, newRevisionId: saves.length, result: "Success" };
    },
    async getCurrentUser() { return "Example"; },
    async listPagesByPrefix() { return []; },
    async listFileInfo() { return []; },
    async getUserInfo() { return null; },
    async userHasPhotoChallengeParticipation() { return false; }
  };

  return { bot, saves };
}

const maintenancePlanJson = JSON.stringify({
  primaryChallenge: "2026 - February - Orange",
  notifications: [
    {
      recipient: "Example Winner",
      fileName: "Orange One.jpg",
      rank: 1,
      targetTitle: "User talk:Example Winner",
      sectionHeading: "[[Commons:Photo challenge/2026 - February - Orange/Winners]]",
      bodyText: "{{Photo Challenge Gold|File:Orange One.jpg|Orange|2026|February}}--~~~~",
      editSummary: "Announcing Photo Challenge winners"
    }
  ],
  assessmentPlans: [
    {
      fileTitle: "File:Orange One.jpg",
      templateText: "{{Photo challenge winner|1|Orange|2026|February}}\n\n",
      editSummary: "Assessment added - congratulations"
    }
  ]
});

test("readExistingPageContent returns null for missing pages", async () => {
  const { bot } = makeFakeBot(new Map());
  assert.equal(await readExistingPageContent(bot, "Missing page"), null);
});

test("prependSandboxSpeedyDeletionTemplate places SD U1 at the top without duplicating it", () => {
  assert.equal(
    prependSandboxSpeedyDeletionTemplate("Sandbox preview"),
    "{{SD|U1}}\nSandbox preview"
  );
  assert.equal(prependSandboxSpeedyDeletionTemplate(""), "{{SD|U1}}");
  assert.equal(
    prependSandboxSpeedyDeletionTemplate("{{ sd | u1 }}\nSandbox preview"),
    "{{ sd | u1 }}\nSandbox preview"
  );
});

test("publishStandardPages saves each planned page and reports messages", async () => {
  const jobId = "publish-service-standard";
  const paths = getJobOutputPaths(jobId);
  await rm(paths.jobRoot, { recursive: true, force: true });
  await mkdir(paths.logsDir, { recursive: true });
  const { bot, saves } = makeFakeBot(new Map());
  const messages: string[] = [];

  const count = await publishStandardPages(
    bot,
    [
      {
        label: "Result Page",
        targetTitle: "User:Example/Sandbox/Result",
        content: "result text",
        editSummary: "Create result"
      }
    ],
    (message) => messages.push(message),
    {
      jobId,
      workflow: "count-votes-and-select-winners",
      operator: "Example Maintainer",
      oauthConsumer: "test-oauth-consumer",
      mode: "sandbox"
    }
  );

  assert.equal(count, 1);
  assert.deepEqual(saves.map((save) => save.title), ["User:Example/Sandbox/Result"]);
  assert.match(messages.join("\n"), /Published Result Page to User:Example\/Sandbox\/Result/);
  const audit = JSON.parse((await readFile(path.join(paths.logsDir, "publish-audit.jsonl"), "utf8")).trim()) as Record<string, unknown>;
  assert.equal(audit.targetTitle, "User:Example/Sandbox/Result");
  assert.equal(audit.revisionId, 1);
  assert.equal(audit.operator, "Example Maintainer");
  assert.equal(audit.oauthConsumer, "test-oauth-consumer");
  await rm(paths.jobRoot, { recursive: true, force: true });
});

test("publishStandardPages marks existing sandbox pages only after every live page succeeds", async () => {
  const jobId = "publish-service-live-sandbox-cleanup";
  const paths = getJobOutputPaths(jobId);
  await rm(paths.jobRoot, { recursive: true, force: true });
  await mkdir(paths.logsDir, { recursive: true });
  const sandboxTitle = "User:Example/Sandbox/2026 - February - Orange/Voting/Result";
  const alreadyMarkedTitle = "User:Example/Sandbox/2026 - February - Orange/Winners";
  const missingTitle = "User:Example/Sandbox/2026 - February - Orange/Voting";
  const pages = new Map([
    [sandboxTitle, "sandbox result"],
    [alreadyMarkedTitle, "{{SD|U1}}\nsandbox winners"]
  ]);
  const { bot, saves } = makeFakeBot(pages);
  const messages: string[] = [];

  const count = await publishStandardPages(
    bot,
    [
      {
        label: "Result Page",
        targetTitle: "Commons:Photo challenge/2026 - February - Orange/Voting/Result",
        content: "live result",
        editSummary: "Create result"
      }
    ],
    (message) => messages.push(message),
    {
      jobId,
      workflow: "count-votes-and-select-winners",
      operator: "Example Maintainer",
      oauthConsumer: "test-oauth-consumer",
      mode: "live"
    },
    [
      { label: "Result Page", targetTitle: sandboxTitle },
      { label: "Winners Page", targetTitle: alreadyMarkedTitle },
      { label: "Voting Page", targetTitle: missingTitle }
    ]
  );

  assert.equal(count, 1);
  assert.deepEqual(saves.map((save) => save.title), [
    "Commons:Photo challenge/2026 - February - Orange/Voting/Result",
    sandboxTitle
  ]);
  assert.equal(saves[1]?.text, "{{SD|U1}}\nsandbox result");
  assert.equal(saves[1]?.summary, "Photo Challenge bot: mark obsolete sandbox page for speedy deletion");
  assert.match(messages.join("\n"), /Marked Result Page sandbox page for deletion/);
  assert.match(messages.join("\n"), /already marked for deletion/);
  assert.match(messages.join("\n"), /page does not exist/);

  const auditRecords = (await readFile(path.join(paths.logsDir, "publish-audit.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(auditRecords.map((record) => record.targetTitle), [
    "Commons:Photo challenge/2026 - February - Orange/Voting/Result",
    sandboxTitle
  ]);
  await rm(paths.jobRoot, { recursive: true, force: true });
});

test("publishStandardPages leaves sandbox pages untouched when a live page fails", async () => {
  const jobId = "publish-service-live-failure-no-cleanup";
  const paths = getJobOutputPaths(jobId);
  await rm(paths.jobRoot, { recursive: true, force: true });
  const sandboxTitle = "User:Example/Sandbox/Challenge/Voting";
  const pages = new Map([[sandboxTitle, "sandbox draft"]]);
  const { bot, saves } = makeFakeBot(pages);
  const originalSavePage = bot.savePage.bind(bot);
  bot.savePage = async (title, text, summary) => {
    if (title.endsWith("/Voting/Result")) {
      throw new Error("simulated live publish failure");
    }
    return originalSavePage(title, text, summary);
  };

  await assert.rejects(
    publishStandardPages(
      bot,
      [
        { label: "Voting Page", targetTitle: "Commons:Photo challenge/Challenge/Voting", content: "voting", editSummary: "Revise voting" },
        { label: "Result Page", targetTitle: "Commons:Photo challenge/Challenge/Voting/Result", content: "result", editSummary: "Create result" }
      ],
      () => undefined,
      {
        jobId,
        workflow: "count-votes-and-select-winners",
        operator: "Example Maintainer",
        oauthConsumer: null,
        mode: "live"
      },
      [{ label: "Voting Page", targetTitle: sandboxTitle }]
    ),
    /simulated live publish failure/
  );

  assert.deepEqual(saves.map((save) => save.title), ["Commons:Photo challenge/Challenge/Voting"]);
  assert.equal(pages.get(sandboxTitle), "sandbox draft");
  await rm(paths.jobRoot, { recursive: true, force: true });
});

test("publishMaintenanceEditPlans skips unchanged live entries and records published history", async () => {
  const jobId = "publish-service-maintenance";
  const paths = getJobOutputPaths(jobId);
  await rm(paths.jobRoot, { recursive: true, force: true });
  await mkdir(paths.generatedDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });

  const entries = buildMaintenancePublishEntries(maintenancePlanJson, "Example@Bot", "live");
  const notification = entries.find((entry) => entry.type === "notifications");
  const assessment = entries.find((entry) => entry.type === "file-assessment");
  assert(notification);
  assert(assessment);

  const { bot, saves } = makeFakeBot(new Map([
    ["User talk:Example Winner", `== ${notification.sections?.[0]?.heading} ==\n${notification.sections?.[0]?.bodyText}`],
    ["File:Orange One.jpg", "Intro\n=={{int:license-header}}==\nLicense"],
    ["User:Example/Sandbox/2026 - February - Orange/Maintenance/File_assessments/Orange_One.jpg", "sandbox assessment"]
  ]));
  const messages: string[] = [];

  const counts = await publishMaintenanceEditPlans(
    bot,
    jobId,
    entries,
    "live",
    (message) => messages.push(message),
    {
      jobId,
      workflow: "post-results-maintenance",
      operator: "Example Maintainer",
      oauthConsumer: "test-oauth-consumer",
      mode: "live"
    },
    [{
      label: "File Assessment",
      targetTitle: "User:Example/Sandbox/2026 - February - Orange/Maintenance/File_assessments/Orange_One.jpg"
    }]
  );

  assert.equal(counts.skippedTotal, 1);
  assert.equal(counts.publishedTotal, 1);
  assert.equal(counts.fileAssessments, 1);
  assert.deepEqual(saves.map((save) => save.title), [
    "File:Orange One.jpg",
    "User:Example/Sandbox/2026 - February - Orange/Maintenance/File_assessments/Orange_One.jpg"
  ]);
  assert.equal(saves[1]?.text, "{{SD|U1}}\nsandbox assessment");
  assert.match(messages.join("\n"), /Skipped Winner Notification/);

  const history = JSON.parse(await readFile(path.join(paths.generatedDir, "maintenance_publish_history.json"), "utf8")) as Array<{
    targetTitle: string;
    operator: string;
    oauthConsumer: string | null;
  }>;
  assert.deepEqual(history.map((record) => record.targetTitle), ["File:Orange One.jpg"]);
  assert.equal(history[0]?.operator, "Example Maintainer");
  assert.equal(history[0]?.oauthConsumer, "test-oauth-consumer");

  const auditContent = await readFile(path.join(paths.logsDir, "publish-audit.jsonl"), "utf8");
  const auditRecords = auditContent.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(auditRecords.map((record) => record.event), ["publish.skipped", "publish.succeeded", "publish.succeeded"]);
  assert.equal(auditRecords[1]?.operator, "Example Maintainer");
  assert.equal(auditRecords[1]?.oauthConsumer, "test-oauth-consumer");
  assert.equal(auditRecords[1]?.mode, "live");
  assert.equal(auditRecords[1]?.targetTitle, "File:Orange One.jpg");
  assert.equal(auditRecords[1]?.revisionId, 1);
  assert.equal(auditRecords[2]?.targetTitle, "User:Example/Sandbox/2026 - February - Orange/Maintenance/File_assessments/Orange_One.jpg");
  assert.equal(typeof auditRecords[1]?.occurredAt, "string");
  assert.equal(auditContent.includes("token"), false);

  await rm(paths.jobRoot, { recursive: true, force: true });
});
