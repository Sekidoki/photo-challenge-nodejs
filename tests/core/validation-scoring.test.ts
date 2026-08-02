import assert from "node:assert/strict";
import { test } from "../support/harness.js";
import { countVotes } from "../../src/core/scoring.js";
import { validateVoters } from "../../src/core/voters.js";
import { lookupCommonsUserInfo, type CommonsBot } from "../../src/services/commons-bot.js";
import type { VotingEntryMember } from "../../src/core/models.js";
import { listErrors, validateVotes, type VoterValidation } from "../../src/core/validation.js";

const challenge = "2026 - February - First aid";

test("lookupCommonsUserInfo follows a renamed user's User-page redirect", async () => {
  const requests: Record<string, unknown>[] = [];
  const user = await lookupCommonsUserInfo(async (params) => {
    requests.push(params);
    if (params.list === "users" && params.ususers === "TSavitski") {
      return { query: { users: [{ name: "TSavitski", missing: true }] } };
    }
    if (params.titles === "User:TSavitski") {
      return {
        query: {
          redirects: [{ from: "User:TSavitski", to: "User:Tyler Savitski" }],
          pages: [{ title: "User:Tyler Savitski" }]
        }
      };
    }
    if (params.list === "users" && params.ususers === "Tyler Savitski") {
      return {
        query: {
          users: [{
            name: "Tyler Savitski",
            editcount: 267,
            registration: "2025-11-19T22:56:19Z"
          }]
        }
      };
    }
    throw new Error(`Unexpected request: ${JSON.stringify(params)}`);
  }, "TSavitski");

  assert.deepEqual(user, {
    name: "Tyler Savitski",
    editCount: 267,
    registration: "2025-11-19T22:56:19Z",
    isRegistered: true,
    isBlocked: false
  });
  assert.equal(requests.length, 3);
});

test("lookupCommonsUserInfo keeps a missing user missing without a User-page redirect", async () => {
  const user = await lookupCommonsUserInfo(async (params) => {
    if (params.list === "users") {
      return { query: { users: [{ name: "Missing voter", missing: true }] } };
    }
    return { query: { pages: [{ title: "User:Missing voter", missing: true }] } };
  }, "Missing voter");

  assert.equal(user?.name, "Missing voter");
  assert.equal(user?.isRegistered, false);
});

test("validateVotes flags late votes and duplicate award usage while keeping valid votes countable", () => {
  const voters: VoterValidation[] = [
    {
      voter: "RegularVoter",
      editCount: 150,
      regDate: "2020-01-01",
      error: 0,
      note: 0,
      isRegistered: true,
      isBlocked: false
    },
    {
      voter: "LateVoter",
      editCount: 200,
      regDate: "2020-01-01",
      error: 0,
      note: 0,
      isRegistered: true,
      isBlocked: false
    },
    {
      voter: "BoundaryVoter",
      editCount: 200,
      regDate: "2020-01-01",
      error: 0,
      note: 0,
      isRegistered: true,
      isBlocked: false
    },
    {
      voter: "BorderlineEntrant",
      editCount: 12,
      regDate: "2026-02-27",
      error: 0,
      note: 4,
      isRegistered: true,
      isBlocked: false
    }
  ];

  const votes = [
    {
      num: 1,
      award: 3 as const,
      voter: "RegularVoter",
      creator: "CreatorOne",
      line: "*{{3/3*}} -- [[User:RegularVoter|RegularVoter]] 12:00, 10 March 2026 (UTC)",
      timestamp: "12:00, 10 March 2026 (UTC)"
    },
    {
      num: 2,
      award: 3 as const,
      voter: "RegularVoter",
      creator: "CreatorTwo",
      line: "*{{3/3*}} -- [[User:RegularVoter|RegularVoter]] 12:05, 10 March 2026 (UTC)",
      timestamp: "12:05, 10 March 2026 (UTC)"
    },
    {
      num: 1,
      award: 2 as const,
      voter: "BoundaryVoter",
      creator: "CreatorOne",
      line: "*{{2/3*}} -- [[User:BoundaryVoter|BoundaryVoter]] 11:59, 1 April 2026 (UTC)",
      timestamp: "11:59, 1 April 2026 (UTC)"
    },
    {
      num: 1,
      award: 2 as const,
      voter: "LateVoter",
      creator: "CreatorOne",
      line: "*{{2/3*}} -- [[User:LateVoter|LateVoter]] 12:00, 1 April 2026 (UTC)",
      timestamp: "12:00, 1 April 2026 (UTC)"
    }
  ];

  const validated = validateVotes(votes, voters, challenge);

  assert.equal(validated[0]?.error, 8);
  assert.equal(validated[1]?.error, 8);
  assert.equal(validated[2]?.error, 0);
  assert.equal(validated[3]?.error, 9);

  const errors = listErrors(validated, voters, challenge).join("\n");
  assert.match(errors, /after voting closed at 2026-04-01 00:00 AoE/);
  assert.match(errors, /=== Other \(potential\) Issues ===/);
  assert.match(errors, /\[\[User:BorderlineEntrant\]\] made less than required 50 edits on Commons/);
});

test("listErrors protects unsigned vote source text from MediaWiki pre-save transforms", () => {
  const validated = validateVotes([{
    num: 268,
    award: 0,
    voter: "",
    creator: "Photographer",
    line: "*{{0/3*}} -- ~~~~",
    timestamp: null
  }], [], challenge);

  const errors = listErrors(validated, [], challenge).join("\n");

  assert.match(errors, /line was: "\*\{\{0\/3\*\}\} -- <nowiki>~~~~<\/nowiki>"/);
});

test("validateVoters treats low-edit voters listed in submission entrants as notes instead of errors", async () => {
  const fakeBot: CommonsBot = {
    async readPage() { throw new Error("not used"); },
    async savePage() { throw new Error("not used"); },
    async getCurrentUser() { return "Example"; },
    async listPagesByPrefix() { return []; },
    async listFileInfo() { return []; },
    async getUserInfo(userName: string) {
      return {
        name: userName,
        editCount: 12,
        registration: "2025-11-25T23:30:23Z",
        isRegistered: true,
        isBlocked: false
      };
    },
    async userHasPhotoChallengeParticipation() { return false; }
  };

  const voters = await validateVoters(fakeBot, [
    {
      num: 48,
      award: 2,
      voter: "Entrant Voter",
      creator: "Other Creator",
      line: "*{{2/3*}} -- [[User:Entrant Voter|Entrant Voter]]",
      timestamp: null
    }
  ], "2026 - April - Fair grounds", ["Entrant_Voter"]);

  assert.deepEqual(voters.map((voter) => ({
    voter: voter.voter,
    editCount: voter.editCount,
    error: voter.error,
    note: voter.note
  })), [
    { voter: "Entrant Voter", editCount: 12, error: 0, note: 4 }
  ]);
});

test("validateVoters does not waive low-edit voters from unrelated challenge contributions", async () => {
  const fakeBot: CommonsBot = {
    async readPage() { throw new Error("not used"); },
    async savePage() { throw new Error("not used"); },
    async getCurrentUser() { return "Example"; },
    async listPagesByPrefix() { return []; },
    async listFileInfo() { return []; },
    async getUserInfo(userName: string) {
      return {
        name: userName,
        editCount: 12,
        registration: "2025-11-25T23:30:23Z",
        isRegistered: true,
        isBlocked: false
      };
    },
    async userHasPhotoChallengeParticipation() { return true; }
  };

  const voters = await validateVoters(fakeBot, [
    {
      num: 175,
      award: 3,
      voter: "JimboGimmeJoe",
      creator: "Other Creator",
      line: "*{{3/3*}} -- [[User:JimboGimmeJoe|JimboGimmeJoe]]",
      timestamp: null
    }
  ], "2026 - April - Wooden bridges", []);

  assert.deepEqual(voters.map((voter) => ({
    voter: voter.voter,
    editCount: voter.editCount,
    error: voter.error,
    note: voter.note
  })), [
    { voter: "JimboGimmeJoe", editCount: 12, error: 4, note: 0 }
  ]);
});

test("countVotes ranks by score and then support", () => {
  const files = [
    { num: 1, fileName: "One.jpg", title: "One", creator: "A" },
    { num: 2, fileName: "Two.jpg", title: "Two", creator: "B" },
    { num: 3, fileName: "Three.jpg", title: "Three", creator: "C" }
  ];
  const votes = [
    { num: 1, award: 3 as const, error: 0 },
    { num: 1, award: 0 as const, error: 0 },
    { num: 2, award: 2 as const, error: 0 },
    { num: 2, award: 1 as const, error: 0 },
    { num: 3, award: 3 as const, error: 1 }
  ];

  const ranked = countVotes(files, votes);

  assert.deepEqual(
    ranked.map((file) => ({ num: file.num, score: file.score, support: file.support, rank: file.rank })),
    [
      { num: 1, score: 3, support: 2, rank: 1 },
      { num: 2, score: 3, support: 2, rank: 1 },
      { num: 3, score: 0, support: 0, rank: 3 }
    ]
  );
});

test("countVotes scores a duo entry once while preserving both members", () => {
  const member = (fileName: string): VotingEntryMember => ({
    role: "submission",
    fileName,
    title: fileName.replace(".jpg", ""),
    user: "PairPhotographer",
    uploaded: null,
    width: null,
    height: null,
    comment: null,
    ownWork: true,
    exists: true,
    active: true
  });
  const entries = [{
    num: 7,
    mode: "duo-coequal" as const,
    members: [member("Outside.jpg"), member("Inside.jpg")]
  }];

  const ranked = countVotes(entries, [
    { num: 7, award: 3, error: 0 },
    { num: 7, award: 1, error: 0 }
  ]);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.score, 4);
  assert.equal(ranked[0]?.support, 2);
  assert.equal(ranked[0]?.fileName, "Outside.jpg");
  assert.deepEqual(ranked[0]?.members.map((entry) => entry.fileName), ["Outside.jpg", "Inside.jpg"]);
});
