import type { EntryMode, VotingEntry, VotingEntryMember, VotingEntryMemberRole } from "./models.js";
import type { SubmissionEntry } from "../parsers/submitting-parser.js";

export type SubmissionEntryAssembly = {
  entries: VotingEntry[];
  issues: string[];
};

const MISSING_REFERENCE_PLACEHOLDERS = new Set([
  "Adwaita image-missing-symbolic.svg"
]);

function createMember(entry: SubmissionEntry, role: VotingEntryMemberRole): VotingEntryMember {
  const isExternalReference = role === "reference" && entry.fileName === "Not on Commons";
  const isMissingReferencePlaceholder = role === "reference"
    && MISSING_REFERENCE_PLACEHOLDERS.has(entry.fileName);
  return {
    role,
    fileName: isExternalReference ? "Blanco portrait.svg" : entry.fileName,
    title: entry.title,
    sourceUrl: entry.sourceUrl ?? null,
    displayKind: isExternalReference || isMissingReferencePlaceholder ? "placeholder" : "commons-file",
    user: null,
    uploaded: null,
    width: null,
    height: null,
    comment: null,
    ownWork: false,
    exists: false,
    active: false
  };
}

function dedupeVotingEntries(entries: VotingEntry[]): VotingEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.members.map((member) => `${member.role}:${member.fileName ?? ""}:${member.title}`).join("|||");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function assembleVotingEntries(submissions: SubmissionEntry[], mode: EntryMode = "single"): SubmissionEntryAssembly {
  if (mode === "single") {
    return {
      entries: dedupeVotingEntries(submissions.map((entry) => ({
        mode,
        members: [createMember(entry, "submission")]
      }))),
      issues: []
    };
  }

  const issues: string[] = [];
  if (submissions.length % 2 !== 0) {
    const unpaired = submissions.at(-1);
    issues.push(`REMOVED: [[:File:${unpaired?.fileName ?? "unknown"}]] has no paired gallery entry.`);
  }

  const entries: VotingEntry[] = [];
  for (let index = 0; index + 1 < submissions.length; index += 2) {
    const first = submissions[index];
    const second = submissions[index + 1];
    if (first.fileName === second.fileName) {
      issues.push(`REMOVED: [[:File:${first.fileName}]] appears twice in the same duo entry.`);
      continue;
    }
    entries.push({
      mode,
      members: mode === "duo-reference"
        ? [createMember(first, "reference"), createMember(second, "submission")]
        : [createMember(first, "submission"), createMember(second, "submission")]
    });
  }

  return { entries: dedupeVotingEntries(entries), issues };
}
