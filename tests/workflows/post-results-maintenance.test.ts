import assert from "node:assert/strict";
import { test } from "../support/harness.js";
import type { ScoredVotingFile } from "../../src/core/scoring.js";
import {
  buildChallengeAnnouncement,
  buildFileAssessmentPlans,
  buildPreviousPageUpdate,
  buildWinnerNotifications,
  insertAssessmentTemplate
} from "../../src/workflows/post-results-maintenance.js";
import { parsePublishedWinnersPage } from "../../src/workflows/run-post-results-maintenance.js";

const orangeTopThree: ScoredVotingFile[] = [
  { num: 8, fileName: "Woman in traditional orange attire at Jaipur Literature Festival.jpg", title: "Woman in traditional orange attire at Jaipur Literature Festival", creator: "Amitash", score: 34, support: 14, rank: 1 },
  { num: 130, fileName: "Tibetan orange cat.jpg", title: "Tibetan orange cat", creator: "Poco a poco", score: 23, support: 10, rank: 2 },
  { num: 54, fileName: "Orange on black.jpg", title: "Orange on black", creator: "VulpesVulpes42", score: 20, support: 8, rank: 3 }
];

const firstAidTopThree: ScoredVotingFile[] = [
  { num: 2, fileName: "First aid training.jpg", title: "First aid training", creator: "MedicOne", score: 17, support: 7, rank: 1 },
  { num: 5, fileName: "First aid kit at station.jpg", title: "First aid kit at station", creator: "BlueSunrise", score: 13, support: 6, rank: 2 },
  { num: 9, fileName: "Volunteer first aid team.jpg", title: "Volunteer first aid team", creator: "Quickresponse", score: 10, support: 5, rank: 3 }
];

test("parsePublishedWinnersPage restores both duo-coequal submission members", () => {
  const files = parsePublishedWinnersPage({
    title: "Commons:Photo challenge/2016 - December - Home appliances/Winners",
    content: [
      "{{Photo challenge winners table",
      "|entry_mode = duo-coequal",
      "|image_1 = Outside.jpg",
      "|title_1 = Outside view",
      "|image_1_2 = Inside.jpg",
      "|title_1_2 = Inside view",
      "|author_1 = PairMaker",
      "|score_1 = 26",
      "|rank_1 = 1",
      "|num_1 = 9",
      "}}"
    ].join("\n"),
    revisionTimestamp: "2017-03-01T00:00:00Z",
    revisionId: 1
  });

  assert.equal(files[0]?.mode, "duo-coequal");
  assert.deepEqual(files[0]?.members?.map((member) => [member.role, member.fileName]), [
    ["submission", "Outside.jpg"],
    ["submission", "Inside.jpg"]
  ]);
});

test("parsePublishedWinnersPage keeps the formal image primary for duo-reference winners", () => {
  const files = parsePublishedWinnersPage({
    title: "Commons:Photo challenge/2015 - September-October - 100 years later/Winners",
    content: [
      "{{Photo challenge winners table",
      "|entry_mode = duo-reference",
      "|reference_image_1 = Archive.jpg",
      "|reference_title_1 = Archive view",
      "|image_1 = Modern.jpg",
      "|title_1 = Modern <br/>view",
      "|author_1 = Restager",
      "|score_1 = 61",
      "|rank_1 = 1",
      "|num_1 = 8",
      "}}"
    ].join("\n"),
    revisionTimestamp: "2016-01-01T00:00:00Z",
    revisionId: 2
  });

  assert.equal(files[0]?.mode, "duo-reference");
  assert.equal(files[0]?.fileName, "Modern.jpg");
  assert.equal(files[0]?.title, "Modern view");
  assert.deepEqual(files[0]?.members?.map((member) => [member.role, member.fileName]), [
    ["reference", "Archive.jpg"],
    ["submission", "Modern.jpg"]
  ]);
});

test("buildWinnerNotifications mirrors the upstream talk-page template structure", () => {
  const notifications = buildWinnerNotifications("2026 - February - Orange", orangeTopThree);

  assert.equal(notifications.length, 3);
  assert.equal(notifications[0]?.targetTitle, "User talk:Amitash");
  assert.equal(notifications[0]?.sectionHeading, "[[Commons:Photo challenge/2026 - February - Orange/Winners]]");
  assert.match(notifications[0]?.bodyText ?? "", /^\{\{Photo Challenge Gold\|File:Woman in traditional orange attire at Jaipur Literature Festival\.jpg\|Orange\|2026\|February\}\}--~~~~$/);
});

test("buildChallengeAnnouncement combines two winners pages and congratulates the six podium authors", () => {
  const announcement = buildChallengeAnnouncement([
    { challenge: "2026 - February - Orange", files: orangeTopThree },
    { challenge: "2026 - February - First aid", files: firstAidTopThree }
  ]);

  assert.equal(announcement.targetTitle, "Commons talk:Photo challenge");
  assert.equal(announcement.sectionHeading, "[[Commons:Photo challenge|Photo challenge]] February results");
  assert.match(announcement.bodyText, /\{\{Commons:Photo challenge\/2026 - February - Orange\/Winners\|height=240\}\}/);
  assert.match(announcement.bodyText, /Congratulations to \[\[User:Amitash\|\]\], \[\[User:Poco a poco\|\]\], \[\[User:VulpesVulpes42\|\]\], \[\[User:MedicOne\|\]\], \[\[User:BlueSunrise\|\]\] and \[\[User:Quickresponse\|\]\]--~~~~/);
});

test("buildChallengeAnnouncement mentions duplicate podium authors once", () => {
  const announcement = buildChallengeAnnouncement([
    { challenge: "2026 - February - Orange", files: orangeTopThree },
    { challenge: "2026 - February - First aid", files: [
      { ...firstAidTopThree[0], creator: "Amitash" },
      firstAidTopThree[1],
      firstAidTopThree[2]
    ] }
  ]);

  const body = announcement.bodyText;
  assert.equal((body.match(/\[\[User:Amitash\|\]\]/g) ?? []).length, 1);
  assert.match(body, /Congratulations to \[\[User:Amitash\|\]\], \[\[User:Poco a poco\|\]\], \[\[User:VulpesVulpes42\|\]\], \[\[User:BlueSunrise\|\]\] and \[\[User:Quickresponse\|\]\]--~~~~/);
});

test("buildPreviousPageUpdate prepends the monthly winners section", () => {
  const update = buildPreviousPageUpdate([
    "2026 - February - Orange",
    "2026 - February - First aid"
  ]);

  assert.equal(update.targetTitle, "Commons:Photo challenge/Previous");
  assert.match(update.prependText, /^=== \{\{ucfirst:\{\{ISOdate\|2026-02\|\{\{PAGELANGUAGE\}\}\}\}\}\} ===/);
  assert.match(update.prependText, /\{\{Commons:Photo challenge\/2026 - February - Orange\/Winners\}\}/);
  assert.equal(update.editSummary, "Add February winners");
});

test("buildFileAssessmentPlans creates top-three file templates for both challenges", () => {
  const plans = buildFileAssessmentPlans([
    { challenge: "2026 - February - Orange", files: orangeTopThree },
    { challenge: "2026 - February - First aid", files: firstAidTopThree }
  ]);

  assert.equal(plans.length, 6);
  assert.equal(plans[0]?.fileTitle, "File:Woman in traditional orange attire at Jaipur Literature Festival.jpg");
  assert.equal(plans[0]?.templateText, "{{Photo challenge winner|1|Orange|2026|February}}\n\n");
  assert.equal(plans[5]?.templateText, "{{Photo challenge winner|3|First aid|2026|February}}\n\n");
});

test("buildWinnerNotifications uses the first formal submission as the duo representative image", () => {
  const notifications = buildWinnerNotifications("2016 - December - Home appliances", [{
    num: 1,
    fileName: "Outside.jpg",
    title: "Outside",
    creator: "PairMaker",
    score: 26,
    support: 13,
    rank: 1,
    mode: "duo-coequal",
    members: [
      { role: "submission", fileName: "Outside.jpg", title: "Outside", creator: "PairMaker" },
      { role: "submission", fileName: "Inside.jpg", title: "Inside", creator: "PairMaker" }
    ]
  }]);

  assert.equal(notifications[0]?.fileName, "Outside.jpg");
  assert.match(notifications[0]?.bodyText ?? "", /\|File:Outside\.jpg\|/);
});

test("buildWinnerNotifications uses the formal submission image for duo-reference winners", () => {
  const notifications = buildWinnerNotifications("2015 - September-October - 100 years later", [{
    num: 1,
    fileName: "Modern.jpg",
    title: "Modern",
    creator: "Restager",
    score: 61,
    support: 26,
    rank: 1,
    mode: "duo-reference",
    members: [
      { role: "reference", fileName: "Archive.jpg", title: "Archive", creator: "" },
      { role: "submission", fileName: "Modern.jpg", title: "Modern", creator: "Restager" }
    ]
  }]);

  assert.equal(notifications[0]?.fileName, "Modern.jpg");
  assert.doesNotMatch(notifications[0]?.bodyText ?? "", /Archive\.jpg/);
});

test("buildFileAssessmentPlans applies duo templates to the formal submission members only", () => {
  const plans = buildFileAssessmentPlans([{
    challenge: "2016 - December - Home appliances",
    files: [{
      num: 1,
      fileName: "Outside.jpg",
      title: "Outside",
      creator: "PairMaker",
      score: 26,
      support: 13,
      rank: 1,
      mode: "duo-coequal",
      members: [
        { role: "submission", fileName: "Outside.jpg", title: "Outside", creator: "PairMaker" },
        { role: "submission", fileName: "Inside.jpg", title: "Inside", creator: "PairMaker" }
      ]
    }, {
      num: 2,
      fileName: "Modern.jpg",
      title: "Modern",
      creator: "Restager",
      score: 24,
      support: 10,
      rank: 2,
      mode: "duo-reference",
      members: [
        { role: "reference", fileName: "Archive.jpg", title: "Archive", creator: "" },
        { role: "submission", fileName: "Modern.jpg", title: "Modern", creator: "Restager" }
      ]
    }]
  }]);

  assert.deepEqual(plans.map((plan) => plan.fileTitle), [
    "File:Outside.jpg",
    "File:Inside.jpg",
    "File:Modern.jpg"
  ]);
  assert.equal(plans[0]?.templateText, "{{Photo challenge winner|1|Home appliances|2016|December}}\n\n");
  assert.equal(plans[2]?.templateText, "{{Photo challenge winner|2|Home appliances|2016|December}}\n\n");
});

test("insertAssessmentTemplate follows the upstream insertion markers", () => {
  const viaLicense = insertAssessmentTemplate(
    "Lead\n=={{int:license-header}}==\nLicense text",
    "{{Photo challenge winner|1|Orange|2026|February}}\n\n"
  );
  assert.match(viaLicense, /==\{\{Assessment\}\}==\n\{\{Photo challenge winner\|1\|Orange\|2026\|February\}\}\n\n==\{\{int:license-header\}\}==/);

  const viaCategory = insertAssessmentTemplate(
    "Lead\n[[Category:Example]]",
    "{{Photo challenge winner|2|Orange|2026|February}}\n\n"
  );
  assert.match(viaCategory, /==\{\{Assessment\}\}==\n\{\{Photo challenge winner\|2\|Orange\|2026\|February\}\}\n\n\[\[Category:Example\]\]/);
});
