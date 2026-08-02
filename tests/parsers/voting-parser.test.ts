import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "../support/harness.js";
import { parseVotingChallenges, parseVotingPage } from "../../src/parsers/voting-parser.js";

const fixturesDir = path.resolve("tests", "fixtures");

test("parseVotingChallenges deduplicates challenge links from the voting index", () => {
  const wikiText = [
    "<!-- Commons:Photo challenge/2026 - Hidden/Voting -->",
    "* [[Commons:Photo challenge/2026 - February - First aid/Voting|First aid]]",
    "* [[Commons:Photo challenge/2026 - February - First aid/Voting|First aid duplicate]]",
    "* [[Commons:Photo challenge/2026 - March - Three-wheelers/Voting|Three-wheelers]]"
  ].join("\n");

  const challenges = parseVotingChallenges(wikiText);

  assert.deepEqual(challenges, [
    { raw: "2026 - February - First aid" },
    { raw: "2026 - March - Three-wheelers" }
  ]);
});

test("parseVotingPage handles the current live voting-page format from Three-wheelers", () => {
  const wikiText = readFileSync(path.join(fixturesDir, "voting-page-current-live.txt"), "utf8");

  const parsed = parseVotingPage(wikiText);

  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.votes.length, 1);
  assert.deepEqual(parsed.files[0], {
    num: 1,
    fileName: "20260328 3-wheeler.jpg",
    title: "Marine three-wheeler, Turku",
    creator: "Tn.kuvat"
  });
  assert.deepEqual(parsed.files[1], {
    num: 8,
    fileName: "Three Wheel Vehicles at Malacca.jpg",
    title: "Three Wheel Vehicles at Malacca",
    creator: "Pauloleong2002"
  });
  assert.equal(parsed.votes[0]?.voter, "Howdy.carabao");
  assert.equal(parsed.votes[0]?.timestamp, "17:12, 1 April 2026 (UTC)");
});

test("parseVotingPage handles the historical live voting-page format from Orange", () => {
  const wikiText = readFileSync(path.join(fixturesDir, "voting-page-historical-live.txt"), "utf8");

  const parsed = parseVotingPage(wikiText);

  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.votes.length, 4);
  assert.deepEqual(parsed.files[0], {
    num: 1,
    fileName: "Dark Butterfly.jpg",
    title: "A butterfly lives in silhouette",
    creator: "Saman Mokhtabad"
  });
  assert.equal(parsed.votes[0]?.voter, "Fischer1961");
  assert.equal(parsed.votes[1]?.voter, "Tn.kuvat");
  assert.equal(parsed.votes[1]?.timestamp, null);
  assert.equal(parsed.votes[3]?.voter, "Sindugab");
  assert.equal(parsed.votes[3]?.timestamp, "14:34, 23 March 2026 (UTC)");
});

test("parseVotingPage repairs an unclosed vote marker and excludes its unexpanded placeholder", () => {
  const wikiText = [
    '===<span class="anchor" id="268">268</span>. Hidden votes===',
    "[[File:Hidden votes.jpg|none|thumb|399px|Hidden votes]]",
    "<!-- '''Creator:''' [[User:Photographer|Photographer]] --> '''Uploaded:''' 2026-06-03",
    "<!-- Vote below this line --",
    "*{{0/3*}} -- ~~~~",
    "*{{3/3*}} -- [[User:HiddenVoter|HiddenVoter]] 12:00, 1 July 2026 (UTC)",
    "<!-- Vote above this line -->",
    '===<span class="anchor" id="269">269</span>. Visible vote===',
    "[[File:Visible vote.jpg|none|thumb|399px|Visible vote]]",
    "<!-- '''Creator:''' [[User:OtherPhotographer|OtherPhotographer]] --> '''Uploaded:''' 2026-06-03",
    "<!-- Vote below this line -->",
    "*{{2/3*}} -- [[User:VisibleVoter|VisibleVoter]] 13:00, 1 July 2026 (UTC)",
    "<!-- Vote above this line -->"
  ].join("\n");

  const parsed = parseVotingPage(wikiText);

  assert.equal(parsed.entries[0]?.members[0]?.user, "Photographer");
  assert.deepEqual(parsed.votes.map((vote) => ({ num: vote.num, voter: vote.voter })), [
    { num: 268, voter: "HiddenVoter" },
    { num: 269, voter: "VisibleVoter" }
  ]);
});

test("parseVotingPage strips language prefixes and template braces from wrapped file captions", () => {
  const wikiText = [
    '===<span class="anchor" id="48">48</span>. Swing ride at the Wurstmarkt Dürkheim===',
    "{{Photo challenge image|[[File:Swing ride at the Wurstmarkt Dürkheim.jpg|thumb|300px]]|en=Swing ride at the Wurstmarkt Dürkheim}}",
    "'''Creator:''' [[User:F. Riedelio|F. Riedelio]] '''Uploaded:''' 2026-04-12",
    "*{{3/3*}} -- [[User:Voter|Voter]] 12:00, 2 May 2026 (UTC)"
  ].join("\n");

  const parsed = parseVotingPage(wikiText);

  assert.deepEqual(parsed.files[0], {
    num: 48,
    fileName: "Swing ride at the Wurstmarkt Dürkheim.jpg",
    title: "Swing ride at the Wurstmarkt Dürkheim",
    creator: "F. Riedelio"
  });
});

test("parseVotingPage groups duo-coequal members and votes into one entry", () => {
  const wikiText = [
    '===<span class="anchor" id="1">1</span>. Appliance pair===',
    "[[File:Appliance outside.jpg|thumb|300px|Outside view]]",
    "'''Creator:''' [[User:PairPhotographer|PairPhotographer]] '''Uploaded:''' 2016-12-12",
    "[[File:Appliance inside.jpg|thumb|300px|Inside view]]",
    "'''Creator:''' [[User:PairPhotographer|PairPhotographer]] '''Uploaded:''' 2016-12-12",
    "<!-- Vote below this line -->",
    "*{{3/3*}} -- [[User:PairVoter|PairVoter]] 12:00, 2 February 2017 (UTC)",
    "<!-- Vote above this line -->"
  ].join("\n");

  const parsed = parseVotingPage(wikiText);

  assert.equal(parsed.entryMode, "duo-coequal");
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0]?.members.length, 2);
  assert.deepEqual(parsed.entries[0]?.members.map((member) => ({
    role: member.role,
    fileName: member.fileName,
    creator: member.user
  })), [
    { role: "submission", fileName: "Appliance outside.jpg", creator: "PairPhotographer" },
    { role: "submission", fileName: "Appliance inside.jpg", creator: "PairPhotographer" }
  ]);
  assert.equal(parsed.votes[0]?.creator, "PairPhotographer");
  assert.equal(parsed.votes[0]?.award, 3);
});

test("parseVotingPage infers duo-reference page mode and preserves drifted archived entries", () => {
  const wikiText = [
    '===<span class="anchor" id="1">1</span>. Then and now===',
    "[[File:Town hall 1900.jpg|thumb|300px|Town hall in 1900]]",
    "[[File:Town hall today.jpg|thumb|300px|Town hall today]]",
    "'''Creator:''' [[User:ModernPhotographer|ModernPhotographer]] '''Uploaded:''' 2015-10-12",
    "*{{2/3*}} -- [[User:HistoryVoter|HistoryVoter]] 12:00, 2 November 2015 (UTC)",
    '===<span class="anchor" id="2">2</span>. Archived drift===',
    "[[File:Missing modern comparison.jpg|thumb|300px|Historical reference still present]]",
    "*{{1/3*}} -- [[User:ArchiveVoter|ArchiveVoter]] 13:00, 2 November 2015 (UTC)"
  ].join("\n");

  const parsed = parseVotingPage(wikiText);

  assert.equal(parsed.entryMode, "duo-reference");
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0]?.members[0]?.role, "reference");
  assert.equal(parsed.entries[0]?.members[1]?.role, "submission");
  assert.equal(parsed.entries[0]?.members[1]?.user, "ModernPhotographer");
  assert.equal(parsed.votes.length, 2);
  assert.equal(parsed.votes[0]?.creator, "ModernPhotographer");
  assert.equal(parsed.votes[1]?.num, 2);
  assert.equal(parsed.entries[1]?.members[1]?.displayKind, "empty");
  assert.match(parsed.issues[0]?.message ?? "", /empty archived member/);
});

test("parseVotingPage handles the real Home appliances duo-coequal voting page", () => {
  const wikiText = readFileSync(path.join(fixturesDir, "voting-page-duo-coequal-home-appliances.txt"), "utf8");

  const parsed = parseVotingPage(wikiText);

  assert.equal(parsed.entryMode, "duo-coequal");
  assert.equal(parsed.entries.length, 20);
  assert.equal(parsed.files.length, 20);
  assert.equal(parsed.votes.length, 74);
  assert.equal(parsed.issues.length, 0);
  assert.deepEqual(parsed.entries[0]?.members.map((member) => ({
    role: member.role,
    fileName: member.fileName,
    creator: member.user
  })), [
    { role: "submission", fileName: "Radio Gnomo esterno.jpg", creator: "Rosapicci" },
    { role: "submission", fileName: "radio Gnomo interno.jpg", creator: "Rosapicci" }
  ]);
});

test("parseVotingPage handles the real 100 years later duo-reference voting page", () => {
  const wikiText = readFileSync(path.join(fixturesDir, "voting-page-duo-reference-100-years-later.txt"), "utf8");

  const parsed = parseVotingPage(wikiText);
  const drifted = parsed.entries.find((entry) => entry.num === 1);
  const placeholder = parsed.entries.find((entry) => entry.num === 12)?.members[0];

  assert.equal(parsed.entryMode, "duo-reference");
  assert.equal(parsed.entries.length, 95);
  assert.equal(parsed.files.length, 94);
  assert.equal(parsed.votes.length, 341);
  assert.deepEqual(parsed.issues, [{ num: 1, message: "Entry #1 contains an empty archived member." }]);
  assert.equal(drifted?.members[1]?.displayKind, "empty");
  assert.equal(placeholder?.fileName, "Blanco portrait.svg");
  assert.equal(placeholder?.displayKind, "placeholder");
  assert.equal(placeholder?.sourceUrl, "http://memoire-net.org/article.php3?id_article=141");
});
