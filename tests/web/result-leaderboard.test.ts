import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "../support/harness.js";
import { parseResultLeaderboard } from "../../src/web/result-leaderboard.js";

const fixturesDir = path.resolve("tests", "fixtures");

test("parseResultLeaderboard exposes the first three scored files for the result page", () => {
  const leaderboard = parseResultLeaderboard(
    readFileSync(path.join(fixturesDir, "scored-files-first-aid-top3.json"), "utf8")
  );

  assert.deepEqual(leaderboard.map(({ rank, creator, score }) => ({ rank, creator, score })), [
    { rank: 1, creator: "Aciarium", score: 20 },
    { rank: 2, creator: "Julian Herzog", score: 12 },
    { rank: 3, creator: "Roy Egloff", score: 9 }
  ]);
  assert.match(leaderboard[0]?.images[0]?.thumbnailUrl ?? "", /Special:Redirect\/file\/DSC09851/);
  assert.equal(leaderboard[0]?.images[0]?.title, "A labrador retriever of the search and rescue dog unit of the Austrian Red Cross. Vienna 2025, Austria.");
});

test("parseResultLeaderboard includes both submission images but excludes reference images", () => {
  const leaderboard = parseResultLeaderboard(JSON.stringify([
    {
      fileName: "Outside.jpg",
      title: "Outside",
      creator: "PairMaker",
      score: 18,
      rank: 1,
      members: [
        { role: "reference", fileName: "Archive.jpg", title: "Archive" },
        { role: "submission", fileName: "Outside.jpg", title: "Outside" },
        { role: "submission", fileName: "Inside.jpg", title: "Inside" }
      ]
    }
  ]));

  assert.deepEqual(leaderboard[0]?.images.map((image) => image.fileName), ["Outside.jpg", "Inside.jpg"]);
});

test("parseResultLeaderboard safely ignores malformed or incomplete artifacts", () => {
  assert.deepEqual(parseResultLeaderboard("not json"), []);
  assert.deepEqual(parseResultLeaderboard(JSON.stringify([{ rank: 1, score: 10 }])), []);
});
