import assert from "node:assert/strict";
import { test } from "../support/harness.js";
import { assembleVotingEntries } from "../../src/core/submission-entries.js";

test("assembleVotingEntries pairs adjacent duo-coequal submissions without shifting later pairs", () => {
  const assembled = assembleVotingEntries([
    { fileName: "Outside.jpg", title: "Outside" },
    { fileName: "Inside.jpg", title: "Inside" },
    { fileName: "Second outside.jpg", title: "Second outside" },
    { fileName: "Second inside.jpg", title: "Second inside" }
  ], "duo-coequal");

  assert.equal(assembled.entries.length, 2);
  assert.deepEqual(
    assembled.entries.map((entry) => entry.members.map((member) => member.fileName)),
    [["Outside.jpg", "Inside.jpg"], ["Second outside.jpg", "Second inside.jpg"]]
  );
});

test("assembleVotingEntries reports an unpaired final duo submission", () => {
  const assembled = assembleVotingEntries([
    { fileName: "Outside.jpg", title: "Outside" },
    { fileName: "Inside.jpg", title: "Inside" },
    { fileName: "Unpaired.jpg", title: "Unpaired" }
  ], "duo-coequal");

  assert.equal(assembled.entries.length, 1);
  assert.match(assembled.issues[0] ?? "", /Unpaired\.jpg.*no paired gallery entry/);
});

test("assembleVotingEntries rejects duplicate members without shifting the next pair", () => {
  const assembled = assembleVotingEntries([
    { fileName: "Duplicate.jpg", title: "Duplicate" },
    { fileName: "Duplicate.jpg", title: "Duplicate" },
    { fileName: "Outside.jpg", title: "Outside" },
    { fileName: "Inside.jpg", title: "Inside" }
  ], "duo-coequal");

  assert.equal(assembled.entries.length, 1);
  assert.deepEqual(assembled.entries[0]?.members.map((member) => member.fileName), ["Outside.jpg", "Inside.jpg"]);
  assert.match(assembled.issues[0] ?? "", /appears twice in the same duo entry/);
});

test("assembleVotingEntries maps external duo-reference sources to traceable placeholders", () => {
  const assembled = assembleVotingEntries([
    { fileName: "Not on Commons", title: "Historical source", sourceUrl: "https://example.test/history" },
    { fileName: "Modern.jpg", title: "Modern submission" }
  ], "duo-reference");

  assert.deepEqual(assembled.entries[0]?.members.map((member) => ({
    role: member.role,
    fileName: member.fileName,
    displayKind: member.displayKind,
    sourceUrl: member.sourceUrl
  })), [
    { role: "reference", fileName: "Blanco portrait.svg", displayKind: "placeholder", sourceUrl: "https://example.test/history" },
    { role: "submission", fileName: "Modern.jpg", displayKind: "commons-file", sourceUrl: null }
  ]);
});

test("assembleVotingEntries marks the Commons missing-image symbol as an untraceable reference placeholder", () => {
  const assembled = assembleVotingEntries([
    { fileName: "Adwaita image-missing-symbolic.svg", title: "Adwaita image-missing-symbolic" },
    { fileName: "Bargi Dam - Jabalpur.jpg", title: "Bargi Dam after the incident" }
  ], "duo-reference");

  assert.deepEqual(assembled.entries[0]?.members.map((member) => ({
    role: member.role,
    fileName: member.fileName,
    displayKind: member.displayKind,
    sourceUrl: member.sourceUrl
  })), [
    {
      role: "reference",
      fileName: "Adwaita image-missing-symbolic.svg",
      displayKind: "placeholder",
      sourceUrl: null
    },
    {
      role: "submission",
      fileName: "Bargi Dam - Jabalpur.jpg",
      displayKind: "commons-file",
      sourceUrl: null
    }
  ]);
});
