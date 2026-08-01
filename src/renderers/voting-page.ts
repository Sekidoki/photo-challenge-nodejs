import path from "node:path";
import { DateTime } from "luxon";
import type { SubmissionWindow, VotingEntry, VotingEntryMember } from "../core/models.js";
import { getVoteDeadlineBannerDate, getVoteDeadlineZoneLabel } from "../core/challenge-date.js";

export type VotingSubmissionEntry = {
  fileName: string;
  title: string;
  user: string | null;
  uploaded: string | null;
  width: number | null;
  height: number | null;
  comment: string | null;
  ownWork: boolean;
  exists: boolean;
  active: boolean;
};

export type RenderVotingPageOptions = {
  submissionWindow?: SubmissionWindow;
  issues?: string[];
};

export type RenderedVotingPage = {
  text: string;
  includedCount: number;
  issueCount: number;
};

type ResolvedSubmissionWindow = {
  startsAt: DateTime;
  endsAt: DateTime;
};

const SIZE_PX = 240000;
const DUO_HEIGHT_PX = 300;
const AOE_UTC_OFFSET_HOURS = 12;
const COLLAPSE_TEXT = "{{Collapse top|Current votes – please choose your own winners before looking}}";

export function renderVotingEntryHeading(num: number, title: string): string {
  const anchor = `<span class="anchor" id="${num}">${num}</span>`;
  return `===${anchor}. ${title}===`;
}

export function resolveSubmissionWindow(challenge: string, configured?: SubmissionWindow): ResolvedSubmissionWindow {
  if (configured) {
    const startsAt = DateTime.fromISO(configured.startsAt, { setZone: true }).toUTC();
    const endsAt = DateTime.fromISO(configured.endsAt, { setZone: true }).toUTC();
    if (!startsAt.isValid || !endsAt.isValid || startsAt >= endsAt) {
      throw new Error("Invalid submission window. Start and end must be valid ISO date/times with start earlier than end.");
    }
    return { startsAt, endsAt };
  }

  const [year, monthName] = challenge.split(" - ");
  const startsAt = DateTime.fromFormat(`1 ${monthName} ${year}`, "d MMMM yyyy", { zone: "utc" });
  if (!startsAt.isValid) {
    throw new Error(`Unable to infer submission window from challenge name: ${challenge}`);
  }
  return { startsAt, endsAt: startsAt.plus({ months: 1 }).startOf("month").plus({ hours: AOE_UTC_OFFSET_HOURS }) };
}

function isVotingEntry(entry: VotingEntry | VotingSubmissionEntry): entry is VotingEntry {
  return "members" in entry;
}

function toVotingEntries(entries: Array<VotingEntry | VotingSubmissionEntry>): VotingEntry[] {
  return entries.map((entry) => isVotingEntry(entry)
    ? entry
    : {
        mode: "single",
        members: [{
          role: "submission",
          displayKind: "commons-file",
          sourceUrl: null,
          ...entry
        }]
      });
}

function formatMegapixels(member: VotingEntryMember): string {
  return ((member.width ?? 0) * (member.height ?? 0) / 1e6)
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

function formatUploaded(member: VotingEntryMember): string {
  return DateTime.fromISO(member.uploaded ?? "", { zone: "utc" }).toFormat("yyyy-LL-dd HH:mm:ss");
}

function renderMetadata(member: VotingEntryMember, collapse = false): string {
  const userLink = `[[User:${member.user}|${member.user}]]`;
  const suffix = collapse ? ` ${COLLAPSE_TEXT}` : "";
  return `<!-- '''Creator:''' ${userLink} --> '''Uploaded:''' ${formatUploaded(member)} '''Size''': ${member.width} × ${member.height} (${formatMegapixels(member)} MP)${suffix}`;
}

function renderFile(member: VotingEntryMember, size: string): string {
  const fileName = member.fileName ?? "";
  const fileLink = `[{{filepath:${fileName}}}<br>''(Full size image)'']`;
  return `[[File:${fileName}|none|thumb|${size}|${member.title} ${fileLink}]]`;
}

function validateSubmission(member: VotingEntryMember | undefined, window: ResolvedSubmissionWindow): string | null {
  const fileName = member?.fileName ?? "";
  if (!member || !member.exists || !member.user || !member.uploaded || !fileName) {
    return `File [[:File:${fileName}]] does not exist`;
  }

  const uploaded = DateTime.fromISO(member.uploaded, { zone: "utc" });
  const userLink = `[[User:${member.user}|${member.user}]]`;
  if (!uploaded.isValid) {
    return `REMOVED: [[:File:${fileName}]] by ${userLink} has an invalid upload timestamp.`;
  }
  const dateStr = uploaded.toFormat("yyyy-LL-dd HH:mm:ss");
  if (uploaded < window.startsAt) {
    return `REMOVED: [[:File:${fileName}]] by ${userLink} was uploaded ${dateStr} before the challenge opened ${window.startsAt.toFormat("yyyy-LL-dd HH:mm:ss")}.`;
  }
  if (uploaded >= window.endsAt) {
    return `REMOVED: [[:File:${fileName}]] by ${userLink} was uploaded ${dateStr} after the challenge closed ${window.endsAt.toFormat("yyyy-LL-dd HH:mm:ss")}.`;
  }
  if (!member.active) {
    return `REMOVED: [[:File:${fileName}]] by ${userLink}, since the user uploded more than allowed 4 entries.`;
  }
  if (!member.width || !member.height) {
    return `REMOVED: [[:File:${fileName}]] by ${userLink} is missing size metadata.`;
  }
  return null;
}

function validateEntry(entry: VotingEntry, window: ResolvedSubmissionWindow): string | null {
  const submissions = entry.members.filter((member) => member.role === "submission");
  if (entry.mode === "single") {
    return validateSubmission(submissions[0], window);
  }
  if (entry.mode === "duo-coequal") {
    if (submissions.length !== 2) return "REMOVED: Duo entry does not contain exactly two submission images.";
    for (const member of submissions) {
      const issue = validateSubmission(member, window);
      if (issue) return issue;
    }
    if (submissions[0].user !== submissions[1].user) {
      return `REMOVED: [[:File:${submissions[0].fileName}]] and [[:File:${submissions[1].fileName}]] have different uploaders.`;
    }
    return null;
  }

  const reference = entry.members.find((member) => member.role === "reference");
  const referenceIsTraceable = Boolean(reference?.fileName && (
    (reference.displayKind === "commons-file" && reference.exists)
    || (reference.displayKind === "placeholder" && reference.sourceUrl)
  ));
  if (!referenceIsTraceable) {
    const submissionFile = submissions[0]?.fileName ?? "unknown";
    return `REMOVED: [[:File:${submissionFile}]] has no traceable historical image or external source link.`;
  }
  return validateSubmission(submissions[0], window);
}

function renderSingleVotingEntry(entry: VotingEntry, num: number): string[] {
  const member = entry.members[0];
  const thumbWidth = Math.max(1, Math.floor(Math.sqrt((SIZE_PX * (member.width ?? 0)) / (member.height ?? 1))));
  return [
    renderVotingEntryHeading(num, path.basename(member.fileName ?? "")),
    renderFile(member, `${thumbWidth}px`),
    renderMetadata(member, true),
    "<!-- Vote below this line -->",
    "<!-- Vote above this line -->",
    "{{Collapse bottom}}",
    ""
  ];
}

function renderDuoVotingEntry(entry: VotingEntry, num: number): string[] {
  const titleMember = [...entry.members].reverse().find((member) => member.role === "submission") ?? entry.members[0];
  const submissions = entry.members.filter((member) => member.role === "submission");
  const lines = [
    renderVotingEntryHeading(num, path.basename(titleMember.fileName ?? "")),
    "{|",
    '|- valign="top"',
    ...entry.members.map((member) => `|width="100pt" |${renderFile(member, `x${DUO_HEIGHT_PX}px`)}`),
    "|}"
  ];

  if (entry.mode === "duo-coequal") {
    submissions.forEach((member, index) => lines.push(renderMetadata(member, index === submissions.length - 1)));
  } else {
    lines.push(renderMetadata(submissions[0], true));
  }
  lines.push("<!-- Vote below this line -->", "<!-- Vote above this line -->", "{{Collapse bottom}}", "");
  return lines;
}

export function renderVotingPage(
  challenge: string,
  sourceEntries: Array<VotingEntry | VotingSubmissionEntry>,
  options: RenderVotingPageOptions = {}
): RenderedVotingPage {
  const [, , ...themeParts] = challenge.split(" - ");
  const theme = themeParts.join(" - ");
  const window = resolveSubmissionWindow(challenge, options.submissionWindow);
  const entries = toVotingEntries(sourceEntries);
  let includedCount = 0;
  const issues = [...(options.issues ?? [])];
  const lines: string[] = [
    "__NOTOC__",
    "",
    `'''Voting will end at midnight ${getVoteDeadlineZoneLabel()} on ${getVoteDeadlineBannerDate(challenge)}'''. The theme was '''${theme}'''.`,
    "",
    "{{Commons:Photo challenge/Voting header/{{SuperFallback|Commons:Photo challenge/Voting header}}}}",
    "{{Commons:Photo challenge/Voting example}}",
    ""
  ];

  for (const entry of entries) {
    const issue = validateEntry(entry, window);
    if (issue) {
      issues.push(issue);
      continue;
    }

    includedCount += 1;
    lines.push(...(entry.mode === "single"
      ? renderSingleVotingEntry(entry, includedCount)
      : renderDuoVotingEntry(entry, includedCount)));
  }

  if (issues.length > 0) {
    lines.push("=== Issues corrected by the [[Commons:Photo challenge/code/create voting.py|software]] ===");
    for (const issue of issues) {
      lines.push(`* ${issue}`);
    }
  }

  return {
    text: `${lines.join("\n")}\n`,
    includedCount,
    issueCount: issues.length
  };
}
