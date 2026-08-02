import { DateTime } from "luxon";
import { formatVoteDeadlineUtc, getVoteDeadlineUtc, getVoteDeadlineZoneLabel } from "./challenge-date.js";
import { protectSignatureTildes } from "./voting-wikitext.js";

export type VoterValidation = {
  voter: string;
  editCount: number;
  regDate: string | null;
  error: number;
  note: number;
  isRegistered: boolean;
  isBlocked: boolean;
};

export type VoteWithError = {
  num: number;
  award: 0 | 1 | 2 | 3;
  voter: string;
  creator: string;
  line: string;
  timestamp: string | null;
  error: number;
};

function isVoteAfterDeadline(timestamp: string | null, deadline: DateTime): boolean {
  if (!timestamp) {
    return false;
  }

  const voteTime = DateTime.fromFormat(timestamp, "H:mm, d MMMM yyyy '(UTC)'", { zone: "utc" });
  if (!voteTime.isValid) {
    return false;
  }

  return voteTime >= deadline;
}

export function validateVotes(
  votes: Array<{ num: number; award: 0 | 1 | 2 | 3; voter: string; creator: string; line: string; timestamp: string | null }>,
  voters: VoterValidation[],
  challenge: string
): VoteWithError[] {
  const voterErrors = new Map(voters.map((voter) => [voter.voter, voter.error]));
  const deadline = getVoteDeadlineUtc(challenge);
  const withErrors: VoteWithError[] = votes.map((vote) => ({
    ...vote,
    error: voterErrors.get(vote.voter) ?? 0
  }));

  for (const vote of withErrors) {
    if (vote.award === 0 && vote.error > 0) {
      vote.error = 0;
    }
  }

  const seenImageVotes = new Set<string>();
  for (const vote of withErrors) {
    const key = `${vote.num}|||${vote.voter}`;
    if (seenImageVotes.has(key)) {
      vote.error = 5;
    } else {
      seenImageVotes.add(key);
    }

    if (!vote.voter) {
      vote.error = 6;
    }

    if (vote.voter && vote.voter === vote.creator) {
      vote.error = 7;
    }

    if (vote.error === 0 && isVoteAfterDeadline(vote.timestamp, deadline)) {
      vote.error = 9;
    }
  }

  const grouped = new Map<string, VoteWithError[]>();
  for (const vote of withErrors) {
    if (vote.award === 0 || vote.error !== 0) {
      continue;
    }

    const key = `${vote.voter}|||${vote.award}`;
    const arr = grouped.get(key) ?? [];
    arr.push(vote);
    grouped.set(key, arr);
  }

  for (const arr of grouped.values()) {
    if (arr.length > 1) {
      for (const vote of arr) {
        vote.error = 8;
      }
    }
  }

  return withErrors;
}

export function listErrors(
  votes: VoteWithError[],
  voters: VoterValidation[],
  challenge: string
): string[] {
  const errors = ["=== Issues corrected by the [[Commons:Photo challenge/code/Photo challenge library.py|software]] ==="];
  const deadlineText = `${formatVoteDeadlineUtc(challenge)} ${getVoteDeadlineZoneLabel()}`;

  for (const voter of voters.filter((row) => row.error > 0)) {
    let prefix = `* [[User:${voter.voter}]] `;
    let message = "";

    switch (voter.error) {
      case 1:
        prefix = `* [[Special:Contributions/${voter.voter}|${voter.voter}]] `;
        message = "is an anonymous IP address";
        break;
      case 2:
        message = "is not registered";
        break;
      case 3:
        message = `registered on ${voter.regDate ?? "unknown date"}, which is less than 10 days before voting started`;
        break;
      case 4:
        message = `made ${voter.editCount} edits on Commons, which is less than required 50`;
        break;
      default:
        break;
    }

    if (message) {
      errors.push(`${prefix}${message} -> their votes were not counted`);
    }
  }

  for (const vote of votes.filter((row) => row.error > 0)) {
    const image = `[[Commons:Photo challenge/${challenge}/Voting#${vote.num}|Image #${vote.num}]]`;

    switch (vote.error) {
      case 5:
        errors.push(`* [[User:${vote.voter}]] voted more than once for ${image} -> subsequent votes were not counted`);
        break;
      case 6:
        errors.push(`* Unsigned vote for ${image} was detected -> it was not counted (line was: "${protectSignatureTildes(vote.line)}")`);
        break;
      case 7:
        errors.push(`* [[User:${vote.voter}]] voted for their own ${image} -> their vote was not counted`);
        break;
      case 9:
        errors.push(`* [[User:${vote.voter}]] voted for ${image} at ${vote.timestamp ?? "unknown time"}, after voting closed at ${deadlineText} -> their vote was not counted`);
        break;
      default:
        break;
    }
  }

  const multiVoteGroups = new Map<string, number[]>();
  for (const vote of votes.filter((row) => row.error === 8)) {
    const key = `${vote.voter}|||${vote.award}`;
    const arr = multiVoteGroups.get(key) ?? [];
    arr.push(vote.num);
    multiVoteGroups.set(key, arr);
  }

  const place = ["", "3rd", "2nd", "1st"];
  for (const [key, nums] of multiVoteGroups.entries()) {
    const [voter, awardText] = key.split("|||");
    const award = Number(awardText);
    const images = nums.map((num) => `[[Commons:Photo challenge/${challenge}/Voting#${num}|${num}]]`).join(", ");
    errors.push(`* [[User:${voter}]] awarded ${place[award]} place to multiple images (${images}) -> those votes were not counted`);
  }

  const notes = voters.filter((row) => row.note > 0);
  if (notes.length > 0) {
    errors.push("");
    errors.push("=== Other (potential) Issues ===");

    for (const voter of notes) {
      let message = "";
      switch (voter.note) {
        case 1:
          message = "is currently blocked";
          break;
        case 3:
          message = "registered less than 10 days before voting started; however, they have entered the challenge with a picture";
          break;
        case 4:
          message = `made less than required 50 edits on Commons; however, they have entered the challenge with a picture`;
          break;
        default:
          break;
      }

      if (message) {
        errors.push(`* [[User:${voter.voter}]] ${message}`);
      }
    }
  }

  if (errors.length === 1) {
    errors.push("* no issues found");
  }

  return errors;
}
