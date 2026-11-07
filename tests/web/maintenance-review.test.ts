import assert from "node:assert/strict";
import { test } from "../support/harness.js";
import { summarizeMaintenanceArtifact } from "../../src/web/maintenance-review.js";
import { buildMaintenancePublishReview, groupMaintenanceReviewEntries, localizeMaintenanceEntry } from "../../src/web/maintenance-publish-review.js";
import { createTranslator } from "../../src/web/i18n.js";
import type { MaintenancePublishEntry } from "../../src/workflows/maintenance-publish.js";
import type { JobProgress } from "../../src/core/models.js";

const baseMaintenanceJob: JobProgress = {
  id: "maintenance-review-job",
  status: "completed",
  currentStep: "Completed",
  percent: 100,
  startedAt: null,
  finishedAt: null,
  messages: [],
  outputDir: "output/jobs/maintenance-review-job",
  action: "post-results-maintenance",
  challenge: "2026 - February - Orange",
  publishMode: "dry-run",
  loginName: "Example User@BotApp",
  errorMessage: null
};

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
  challengeAnnouncement: {
    targetTitle: "Commons talk:Photo challenge",
    sectionHeading: "[[Commons:Photo challenge|Photo challenge]] February results",
    bodyText: "Announcement body",
    editSummary: "Announcing Photo Challenge winners"
  },
  previousPageUpdate: {
    targetTitle: "Commons:Photo challenge/Previous",
    prependText: "=== Header ===\n{{Winners}}\n",
    editSummary: "Add February winners"
  },
  assessmentPlans: [
    {
      fileTitle: "File:Orange One.jpg",
      templateText: "{{Photo challenge winner|1|Orange|2026|February}}\n\n",
      editSummary: "Assessment added - congratulations"
    }
  ]
}, null, 2);

test("summarizeMaintenanceArtifact reads maintenance plan counts and source jobs", () => {
  const entry = summarizeMaintenanceArtifact("2026_-_February_-_Orange_maintenance_plan.json", JSON.stringify({
    mode: "dry-run",
    primaryChallenge: "2026 - February - Orange",
    pairedChallenge: "2026 - February - First aid",
    sourceJobs: [
      { challenge: "2026 - February - Orange", jobId: "job-orange" },
      { challenge: "2026 - February - First aid", jobId: "job-first-aid" }
    ],
    notifications: [{}, {}, {}],
    challengeAnnouncement: { targetTitle: "Commons talk:Photo challenge" },
    previousPageUpdate: { prependText: "== 2026 February ==" },
    assessmentPlans: [{}, {}]
  }, null, 2));

  assert(entry);
  assert.equal(entry.type, "maintenance-plan");
  assert.equal(entry.summary, "2 source challenge(s), 3 winner notification(s), 2 assessment edit(s).");
  assert.equal(entry.excerpt.some((line) => line.includes("job-orange")), true);
});

test("buildMaintenancePublishReview builds disabled entries when no bot is available", async () => {
  const review = await buildMaintenancePublishReview(
    baseMaintenanceJob,
    "sandbox",
    [],
    "Example User@BotApp",
    null,
    [{ name: "2026_-_February_-_Orange_maintenance_plan.json", content: maintenancePlanJson }]
  );

  assert.equal(review.canPublish, false);
  assert.equal(review.entries.length, 4);
  assert.equal(review.entries.every((entry) => entry.selected), true);
  assert.match(review.warning ?? "", /saved BotPassword/);
  assert.equal(review.overview?.type, "maintenance-plan");
});

test("buildMaintenancePublishReview reports malformed maintenance plan warnings", async () => {
  const review = await buildMaintenancePublishReview(
    baseMaintenanceJob,
    "sandbox",
    [],
    "Example User@BotApp",
    null,
    [{
      name: "2026_-_February_-_Orange_maintenance_plan.json",
      content: JSON.stringify({
        notifications: []
      })
    }]
  );

  assert.equal(review.canPublish, false);
  assert.deepEqual(review.entries, []);
  assert.match(review.warning ?? "", /primaryChallenge/);
});

test("summarizeMaintenanceArtifact reads notification targets and headings", () => {
  const entry = summarizeMaintenanceArtifact("2026_-_February_-_Orange_winner_notifications.txt", [
    "Target: User talk:Example",
    "Heading: Photo Challenge winner",
    "",
    "Congratulations!"
  ].join("\n"));

  assert(entry);
  assert.equal(entry.type, "notifications");
  assert.equal(entry.targetTitle, "User talk:Example");
  assert.equal(entry.heading, "Photo Challenge winner");
  assert.equal(entry.summary, "1 notification target(s) prepared.");
});

test("summarizeMaintenanceArtifact reads file assessment plan counts", () => {
  const entry = summarizeMaintenanceArtifact("2026_-_February_-_Orange_file_assessments.json", JSON.stringify([
    { targetTitle: "File:One.jpg" },
    { targetTitle: "File:Two.jpg" },
    { targetTitle: "File:Three.jpg" }
  ], null, 2));

  assert(entry);
  assert.equal(entry.type, "file-assessments");
  assert.equal(entry.summary, "3 file assessment edit(s) prepared.");
  assert.deepEqual(entry.excerpt, ["File:One.jpg", "File:Two.jpg", "File:Three.jpg"]);
});

test("localizeMaintenanceEntry rewrites workflow labels in the reader's language", () => {
  const t = createTranslator("zh-TW");
  const base = { editSummary: "", excerpt: [], targetTitle: "User:Example/Sandbox" };
  const notification: MaintenancePublishEntry = {
    ...base,
    id: "notifications:User talk:Aciarium",
    type: "notifications",
    label: "Winner Notification",
    description: "Prepared 2 winner message(s) for Aciarium.",
    liveTargetTitle: "User talk:Aciarium",
    sections: [
      { heading: "A", bodyText: "", recipient: "Aciarium", fileName: "a.jpg" },
      { heading: "B", bodyText: "", recipient: "Aciarium", fileName: "b.jpg" }
    ]
  };
  const assessment: MaintenancePublishEntry = {
    ...base,
    id: "file-assessment:File:a.jpg",
    type: "file-assessment",
    label: "File Assessment",
    description: "Apply the assessment template to File:a.jpg.",
    liveTargetTitle: "File:a.jpg"
  };

  const localizedNotification = localizeMaintenanceEntry(notification, t);
  assert.equal(localizedNotification.label, "得獎通知");
  assert.equal(localizedNotification.description, "給 Aciarium 的得獎通知：2 則");
  assert.equal(localizedNotification.sections?.length, 2);
  assert.equal(localizeMaintenanceEntry(assessment, t).description, "為 File:a.jpg 加上評級模板。");
});

test("groupMaintenanceReviewEntries keeps a fixed order and drops empty groups", async () => {
  const review = await buildMaintenancePublishReview(
    baseMaintenanceJob,
    "sandbox",
    [],
    "Example User@BotApp",
    null,
    [{ name: "2026_-_February_-_Orange_maintenance_plan.json", content: maintenancePlanJson }]
  );
  const groups = groupMaintenanceReviewEntries(review.entries, createTranslator("en"));

  assert.deepEqual(groups.map((group) => group.type), [...new Set(review.entries.map((entry) => entry.type))].sort(
    (left, right) => ["notifications", "announcement", "previous-page", "file-assessment"].indexOf(left) - ["notifications", "announcement", "previous-page", "file-assessment"].indexOf(right)
  ));
  assert.equal(groups.reduce((total, group) => total + group.entries.length, 0), review.entries.length);
  assert.equal(groups.every((group) => group.hasMultiple === group.entries.length > 1), true);
});
