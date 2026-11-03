import { DateTime } from "luxon";
import type { CommonsBot } from "../services/commons-bot.js";
import type { ParsedVote } from "../parsers/voting-parser.js";
import type { VoterValidation } from "./validation.js";
import { decodeHtmlEntities } from "./html-entities.js";

function isNumericIp(value: string): boolean {
  return /^[0-9.]+$/.test(value);
}

export async function validateVoters(
  bot: CommonsBot,
  votes: ParsedVote[],
  challenge: string,
  entrantNames: Iterable<string> = []
): Promise<VoterValidation[]> {
  const [year, monthName] = challenge.split(" - ");
  const startDate = DateTime.fromFormat(`30 ${monthName} ${year}`, "d MMMM yyyy", { zone: "utc" });
  const uniqueVoters = [...new Set(votes.map((vote) => vote.voter).filter(Boolean))];
  const entrants = new Set([...entrantNames].map((name) => normalizeUserName(name)).filter(Boolean));
  const results: VoterValidation[] = [];

  for (const voter of uniqueVoters) {
    if (isNumericIp(voter)) {
      results.push({
        voter,
        editCount: -1,
        regDate: null,
        error: 1,
        note: 0,
        isRegistered: false,
        isBlocked: false
      });
      continue;
    }

    const userInfo = await bot.getUserInfo(voter);
    if (!userInfo || !userInfo.isRegistered) {
      results.push({
        voter,
        editCount: userInfo?.editCount ?? -1,
        regDate: userInfo?.registration ?? null,
        error: 2,
        note: 0,
        isRegistered: false,
        isBlocked: Boolean(userInfo?.isBlocked)
      });
      continue;
    }

    // MediaWiki has no registration date for accounts created before it began
    // recording one (around 2005), so an existing account without a date is old,
    // not new; it passes the 10-day age rule. The edit-count rule still applies.
    const regDate = userInfo.registration ? DateTime.fromISO(userInfo.registration, { zone: "utc" }) : null;
    const daysActive = regDate ? Math.floor(startDate.diff(regDate, "days").days) : Number.POSITIVE_INFINITY;
    const hasChallengeParticipation = entrants.has(normalizeUserName(voter));

    let error = 0;
    let note = userInfo.isBlocked ? 1 : 0;
    if (daysActive < 10) {
      if (hasChallengeParticipation) {
        note = 3;
      } else {
        error = 3;
      }
    }
    if (userInfo.editCount < 50) {
      if (hasChallengeParticipation) {
        note = 4;
      } else if (error === 0) {
        error = 4;
      }
    }

    results.push({
      voter,
      editCount: userInfo.editCount,
      regDate: userInfo.registration,
      error,
      note,
      isRegistered: true,
      isBlocked: userInfo.isBlocked
    });
  }

  return results;
}

function normalizeUserName(value: string): string {
  return decodeHtmlEntities(value).trim().replace(/_/g, " ").replace(/\s+/g, " ").toLowerCase();
}
