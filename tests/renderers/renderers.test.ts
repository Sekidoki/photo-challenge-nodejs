import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "../support/harness.js";
import { renderResultPage } from "../../src/renderers/result-page.js";
import { reviseVotingPage } from "../../src/renderers/revised-voting-page.js";
import { renderVotingEntryHeading, renderVotingPage, resolveSubmissionWindow } from "../../src/renderers/voting-page.js";
import { renderWinnersPage } from "../../src/renderers/winners-page.js";
import type { VotingEntryMember } from "../../src/core/models.js";
import type { ScoredVotingFile } from "../../src/core/scoring.js";

const fixturesDir = path.resolve("tests", "fixtures");

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), "utf8").replace(/\r\n/g, "\n");
}

function submissionMember(fileName: string, user = "Photographer"): VotingEntryMember {
  return {
    role: "submission",
    fileName,
    title: fileName.replace(/\.[^.]+$/, ""),
    sourceUrl: null,
    displayKind: "commons-file",
    user,
    uploaded: "2016-12-15T08:00:00Z",
    width: 4000,
    height: 3000,
    comment: "own work",
    ownWork: true,
    exists: true,
    active: true
  };
}

function scoredDuoFile(
  mode: "duo-coequal" | "duo-reference",
  members: ScoredVotingFile["members"],
  overrides: Partial<ScoredVotingFile> = {}
): ScoredVotingFile {
  const submission = members?.find((member) => member.role === "submission");
  return {
    num: overrides.num ?? 1,
    fileName: overrides.fileName ?? submission?.fileName ?? "Submission.jpg",
    title: overrides.title ?? submission?.title ?? "Submission",
    creator: overrides.creator ?? submission?.creator ?? "Photographer",
    score: overrides.score ?? 9,
    support: overrides.support ?? 4,
    rank: overrides.rank ?? 1,
    mode,
    members
  };
}

test("renderVotingEntryHeading uses the current span anchor format for every entry mode", () => {
  assert.equal(
    renderVotingEntryHeading(7, "Appliance pair"),
    '===<span class="anchor" id="7">7</span>. Appliance pair==='
  );
});

test("resolveSubmissionWindow defaults to one calendar month ending at midnight AoE", () => {
  const window = resolveSubmissionWindow("2026 - December - Home appliances");

  assert.equal(window.startsAt.toISO(), "2026-12-01T00:00:00.000Z");
  assert.equal(window.endsAt.toISO(), "2027-01-01T12:00:00.000Z");
});

test("renderVotingPage produces issues for invalid entries and includes valid images", () => {
  const rendered = renderVotingPage("2026 - March - Three-wheelers", [
    {
      fileName: "Valid entry.jpg",
      title: "Valid entry",
      user: "Photographer",
      uploaded: "2026-03-10T08:00:00Z",
      width: 4000,
      height: 3000,
      comment: null,
      ownWork: true,
      exists: true,
      active: true
    },
    {
      fileName: "Too late.jpg",
      title: "Too late",
      user: "Photographer",
      uploaded: "2026-04-01T13:00:00Z",
      width: 4000,
      height: 3000,
      comment: null,
      ownWork: true,
      exists: true,
      active: true
    }
  ]);

  assert.equal(rendered.includedCount, 1);
  assert.equal(rendered.issueCount, 1);
  assert.match(rendered.text, /Valid entry.jpg/);
  assert.match(rendered.text, /after the challenge closed/);
  assert.match(rendered.text, /=== Issues corrected by the \[\[toolforge:photo-challenge\|Photo Challenge tool\]\] ===/);
});

test("renderVotingPage renders duo-coequal entries with one span anchor and one voting area", () => {
  const rendered = renderVotingPage("2016 - December - Home appliances", [{
    mode: "duo-coequal",
    members: [submissionMember("Outside.jpg"), submissionMember("Inside.jpg")]
  }], {
    submissionWindow: {
      startsAt: "2016-12-01T00:00:00Z",
      endsAt: "2017-02-01T00:00:00Z"
    }
  });

  assert.equal(rendered.includedCount, 1);
  assert.match(rendered.text, /===<span class="anchor" id="1">1<\/span>\. Inside\.jpg===/);
  assert.match(rendered.text, /\[\[File:Outside\.jpg\|none\|thumb\|x300px/);
  assert.match(rendered.text, /\[\[File:Inside\.jpg\|none\|thumb\|x300px/);
  assert.equal(rendered.text.match(/Vote below this line/g)?.length, 1);
});

test("renderVotingPage renders duo-reference placeholders with an external source and submission metadata", () => {
  const reference: VotingEntryMember = {
    role: "reference",
    fileName: "Blanco portrait.svg",
    title: "Historical source [https://example.test/history link]",
    sourceUrl: "https://example.test/history",
    displayKind: "placeholder",
    user: null,
    uploaded: null,
    width: null,
    height: null,
    comment: null,
    ownWork: false,
    exists: true,
    active: true
  };
  const rendered = renderVotingPage("2015 - September - 100 years later", [{
    mode: "duo-reference",
    members: [reference, {
      ...submissionMember("Modern.jpg"),
      uploaded: "2015-10-12T08:00:00Z"
    }]
  }], {
    submissionWindow: {
      startsAt: "2015-09-01T00:00:00Z",
      endsAt: "2015-11-01T00:00:00Z"
    }
  });

  assert.equal(rendered.includedCount, 1);
  assert.match(rendered.text, /Blanco portrait\.svg/);
  assert.match(rendered.text, /https:\/\/example\.test\/history/);
  assert.equal(rendered.text.match(/'''Creator:'''/g)?.length, 1);
});

test("renderVotingPage removes a duo-reference entry whose historical image is only a missing-image placeholder", () => {
  const reference: VotingEntryMember = {
    role: "reference",
    fileName: "Adwaita image-missing-symbolic.svg",
    title: "Adwaita image-missing-symbolic",
    sourceUrl: null,
    displayKind: "placeholder",
    user: null,
    uploaded: null,
    width: null,
    height: null,
    comment: null,
    ownWork: false,
    exists: true,
    active: true
  };
  const rendered = renderVotingPage("2026 - July - Disaster rephotography", [{
    mode: "duo-reference",
    members: [reference, {
      ...submissionMember("Bargi Dam - Jabalpur.jpg", "Gamerzer"),
      uploaded: "2026-07-14T07:22:45Z"
    }]
  }]);

  assert.equal(rendered.includedCount, 0);
  assert.equal(rendered.issueCount, 1);
  assert.doesNotMatch(rendered.text, /id="1"/);
  assert.match(
    rendered.text,
    /REMOVED: \[\[:File:Bargi Dam - Jabalpur\.jpg\]\] has no traceable historical image or external source link\./
  );
});

test("renderWinnersPage matches the real First aid winners output for the top three files", () => {
  const scoredFiles = JSON.parse(readFixture("scored-files-first-aid-top3.json")) as Array<{
    num: number;
    fileName: string;
    title: string;
    creator: string;
    score: number;
    support: number;
    rank: number;
  }>;
  const expected = readFixture("winners-first-aid-top3.txt");

  const rendered = renderWinnersPage(scoredFiles, "2026 - February - First aid");

  assert.equal(rendered, expected);
});

test("renderResultPage matches the expected table output for real First aid top-ranked files", () => {
  const scoredFiles = JSON.parse(readFixture("scored-files-first-aid-top3.json")) as Array<{
    num: number;
    fileName: string;
    title: string;
    creator: string;
    score: number;
    support: number;
    rank: number;
  }>;
  const expected = readFixture("result-first-aid-top3.txt");

  const rendered = renderResultPage(scoredFiles, 17, ["* no issues found"]);

  assert.equal(rendered, expected);
});

test("renderResultPage renders duo-coequal entries with two image columns", () => {
  const rendered = renderResultPage([
    scoredDuoFile("duo-coequal", [
      { role: "submission", fileName: "Outside.jpg", title: "Outside", creator: "PairMaker" },
      { role: "submission", fileName: "Inside.jpg", title: "Inside", creator: "PairMaker" }
    ])
  ], 6, []);

  assert.match(rendered, /! Image1 !! Image2 !! Author/);
  assert.match(rendered, /\[\[File:Outside\.jpg\|120px\]\] \|\| \[\[File:Inside\.jpg\|120px\]\]/);
  assert.match(rendered, /\|\| \[\[User:PairMaker\|PairMaker\]\]/);
});

test("renderResultPage renders duo-reference entries using only the formal submission image", () => {
  const rendered = renderResultPage([
    scoredDuoFile("duo-reference", [
      { role: "reference", fileName: "Archive.jpg", title: "Archive", creator: "" },
      { role: "submission", fileName: "Modern.jpg", title: "Modern", creator: "Restager" }
    ])
  ], 6, []);

  assert.match(rendered, /! class="unsortable"\| Image/);
  assert.match(rendered, /\[\[File:Modern\.jpg\|120px\]\]/);
  assert.doesNotMatch(rendered, /\[\[File:Archive\.jpg\|120px\]\]/);
});

test("renderWinnersPage renders duo-coequal winners with the shared winners template", () => {
  const rendered = renderWinnersPage([
    scoredDuoFile("duo-coequal", [
      { role: "submission", fileName: "Outside.jpg", title: "Outside view", creator: "PairMaker" },
      { role: "submission", fileName: "Inside.jpg", title: "Inside view", creator: "PairMaker" }
    ], { score: 26 })
  ], "2016 - December - Home appliances");

  assert.match(rendered, /^\{\{Photo challenge winners table/);
  assert.match(rendered, /\|entry_mode = duo-coequal/);
  assert.match(rendered, /\|image_1\s+= Outside\.jpg/);
  assert.match(rendered, /\|title_1\s+= Outside view/);
  assert.match(rendered, /\|image_1_2\s+= Inside\.jpg/);
  assert.match(rendered, /\|title_1_2\s+= Inside view/);
  assert.match(rendered, /\|author_1 = PairMaker/);
  assert.match(rendered, /\|score_1\s+= 26/);
});

test("renderWinnersPage renders duo-reference winners with the shared winners template", () => {
  const rendered = renderWinnersPage([
    scoredDuoFile("duo-reference", [
      { role: "reference", fileName: "Archive.jpg", title: "Archive view", creator: "" },
      { role: "submission", fileName: "Modern.jpg", title: "Modern view", creator: "Restager" }
    ], { score: 61 })
  ], "2015 - September-October - 100 years later");

  assert.match(rendered, /^\{\{Photo challenge winners table/);
  assert.match(rendered, /\|entry_mode = duo-reference/);
  assert.match(rendered, /\|reference_image_1 = Archive\.jpg/);
  assert.match(rendered, /\|reference_title_1 = Archive view/);
  assert.match(rendered, /\|image_1\s+= Modern\.jpg/);
  assert.match(rendered, /\|title_1\s+= Modern view/);
  assert.match(rendered, /\|author_1 = Restager/);
  assert.match(rendered, /\|score_1\s+= 61/);
});

test("reviseVotingPage matches the current revised output for a historical Orange voting snippet", () => {
  const source = readFixture("voting-page-historical-live.txt");
  const expected = readFixture("revised-orange-live-expected.txt");

  const rendered = reviseVotingPage(source);

  assert.equal(rendered, expected);
});

test("reviseVotingPage repairs an unclosed vote marker and protects its placeholder signature", () => {
  const source = [
    '===<span class="anchor" id="268">268</span>. Hidden votes===',
    "<!-- Vote below this line --",
    "*{{0/3*}} -- ~~~~",
    "*{{3/3*}} -- [[User:ValidVoter|ValidVoter]] 12:00, 1 July 2026 (UTC)",
    "<!-- Vote above this line -->"
  ].join("\n");

  const rendered = reviseVotingPage(source);

  assert.match(rendered, /<!-- Vote below this line -->/);
  assert.match(rendered, /\*\{\{0\/3\*\}\} -- <nowiki>~~~~<\/nowiki>/);
  assert.doesNotMatch(rendered, /-- ~~~~(?:\r?\n|$)/);
  assert.match(rendered, /\*\{\{3\/3\*\}\} -- \[\[User:ValidVoter/);
});
