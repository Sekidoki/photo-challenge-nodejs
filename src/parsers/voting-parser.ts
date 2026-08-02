import type { EntryMode, VotingEntry, VotingEntryMember } from "../core/models.js";
import { isUnexpandedVotePlaceholder, repairVoteBelowMarker } from "../core/voting-wikitext.js";

export type VotingChallenge = {
  raw: string;
};

/** Temporary single-file projection for Phase 1 renderer compatibility. */
export type VotingFile = {
  num: number;
  fileName: string;
  title: string;
  creator: string;
};

export type ParsedVote = {
  num: number;
  award: 0 | 1 | 2 | 3;
  voter: string;
  creator: string;
  line: string;
  timestamp: string | null;
};

export type VotingParserIssue = {
  num: number;
  message: string;
};

export type ParsedVotingPage = {
  entryMode: EntryMode;
  entries: VotingEntry[];
  /** Temporary single-file projection for Phase 1 renderer compatibility. */
  files: VotingFile[];
  votes: ParsedVote[];
  issues: VotingParserIssue[];
};

type VotingSectionBuilder = {
  num: number;
  members: VotingEntryMember[];
  creatorLines: string[];
  votes: Omit<ParsedVote, "creator">[];
};

function stripComments(text: string): string {
  return text.replace(/<!--([\s\S]*?)-->/g, "");
}

function stripCommentsFromLine(line: string, startsInComment: boolean): { text: string; endsInComment: boolean } {
  let text = "";
  let index = 0;
  let inComment = startsInComment;

  while (index < line.length) {
    if (inComment) {
      const commentEnd = line.indexOf("-->", index);
      if (commentEnd < 0) {
        return { text, endsInComment: true };
      }
      inComment = false;
      index = commentEnd + 3;
      continue;
    }

    const commentStart = line.indexOf("<!--", index);
    if (commentStart < 0) {
      text += line.slice(index);
      break;
    }

    text += line.slice(index, commentStart);
    inComment = true;
    index = commentStart + 4;
  }

  return { text, endsInComment: inComment };
}

function substr(pattern: RegExp, text: string): string {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function extractSignatureTimestamp(line: string): string | null {
  const match = line.match(/(\d{1,2}:\d{2},\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}\s+\(UTC\))/);
  return match?.[1] ?? null;
}

function extractSectionNumber(line: string): number {
  return Number(substr(/<span[^>]*>(\d+)<\/span>/, line) || substr(/^===\s*(\d+)\./, line) || 0);
}

function createMember(fileName: string, title: string, sourceUrl?: string | null): VotingEntryMember {
  return {
    role: "submission",
    fileName,
    title,
    sourceUrl,
    displayKind: fileName === "Blanco portrait.svg" ? "placeholder" : "commons-file",
    user: null,
    uploaded: null,
    width: null,
    height: null,
    comment: null,
    ownWork: false,
    exists: true,
    active: true
  };
}

function createEmptyMember(role: "submission" | "reference"): VotingEntryMember {
  return {
    role,
    fileName: null,
    title: "",
    sourceUrl: null,
    displayKind: "empty",
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

function splitTopLevelPipes(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let templateDepth = 0;
  let linkDepth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const pair = text.slice(index, index + 2);
    if (pair === "{{") {
      templateDepth += 1;
      index += 1;
      continue;
    }
    if (pair === "}}" && templateDepth > 0) {
      templateDepth -= 1;
      index += 1;
      continue;
    }
    if (pair === "[[") {
      linkDepth += 1;
      index += 1;
      continue;
    }
    if (pair === "]]" && linkDepth > 0) {
      linkDepth -= 1;
      index += 1;
      continue;
    }
    if (text[index] === "|" && templateDepth === 0 && linkDepth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

function findBalancedEnd(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const pair = text.slice(index, index + 2);
    if (pair === open) {
      depth += 1;
      index += 1;
      continue;
    }
    if (pair === close && depth > 0) {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return text.length;
}

function findEnclosingTemplateText(line: string, position: number): string | null {
  const stack: number[] = [];
  let candidate: string | null = null;

  for (let index = 0; index < line.length - 1; index += 1) {
    const pair = line.slice(index, index + 2);
    if (pair === "{{") {
      stack.push(index);
      index += 1;
      continue;
    }
    if (pair === "}}" && stack.length > 0) {
      const start = stack.pop() ?? 0;
      const end = index + 2;
      if (start <= position && position < end) {
        candidate = line.slice(start, end);
      }
      index += 1;
    }
  }

  return candidate;
}

function cleanCaption(caption: string, fileName: string): string {
  let cleaned = caption
    .split(/\s*\[\{\{filepath:/i)[0]
    .replace(/\]\]+$/, "")
    .trim();

  const langSwitch = cleaned.match(/^\{\{\s*LangSwitch\s*\|([\s\S]*)\}\}$/i);
  if (langSwitch?.[1]) {
    const langParts = splitTopLevelPipes(langSwitch[1]);
    cleaned = langParts.find((part) => /^\s*en\s*=/.test(part)) ?? langParts[0] ?? cleaned;
  }

  cleaned = cleaned
    .replace(/^\s*[a-z][a-z0-9-]{1,11}\s*=\s*/i, "")
    .trim();

  return cleaned || fileName.replace(/\.[^.]+$/, "");
}

function pickCaptionPart(parts: string[], fileName: string): string {
  const options = /^(?:none|left|right|center|thumb|thumbnail|frame|frameless|border|upright(?:=[\d.]+)?|alt=.*|class=.*|link=.*|page=\d+|\d+x?\d*px|x\d+px)$/i;
  const caption = parts
    .slice(1)
    .map((part) => part.trim())
    .filter((part) => part && !options.test(part))
    .at(-1);

  return caption ? cleanCaption(caption, fileName) : fileName.replace(/\.[^.]+$/, "");
}

function extractTitleFromTemplate(templateText: string, fileName: string): string | null {
  const inner = templateText.replace(/^\{\{/, "").replace(/\}\}$/, "");
  const parts = splitTopLevelPipes(inner);
  const languageCaption = parts
    .map((part) => part.trim())
    .find((part) => /^\s*en\s*=/.test(part));

  if (languageCaption) {
    return cleanCaption(languageCaption, fileName);
  }

  const caption = parts
    .slice(1)
    .map((part) => part.trim())
    .filter((part) => part && !part.includes(`[[File:${fileName}`) && !/^(?:file|image|width|height|size|align|alt)\s*=/i.test(part))
    .at(-1);

  return caption ? cleanCaption(caption, fileName) : null;
}

function extractTitle(line: string, fileName: string, fileStart: number): string {
  const fileEnd = findBalancedEnd(line, fileStart, "[[", "]]");
  const fileText = line.slice(fileStart, fileEnd);
  const fileParts = splitTopLevelPipes(fileText.replace(/^\[\[/, "").replace(/\]\]$/, ""));
  const caption = pickCaptionPart(fileParts, fileName);
  if (caption !== fileName.replace(/\.[^.]+$/, "")) {
    return caption;
  }

  const templateText = findEnclosingTemplateText(line, fileStart);
  return templateText ? extractTitleFromTemplate(templateText, fileName) ?? caption : caption;
}

function appendFileMembers(section: VotingSectionBuilder, line: string): void {
  const matches = line.matchAll(/\[\[File:([^|\]]+)/gi);
  for (const match of matches) {
    const fileName = match[1]?.trim() ?? "";
    if (!fileName || fileName === "Sample-image.svg") {
      continue;
    }
    const fileStart = match.index ?? 0;
    const fileText = line.slice(fileStart);
    const sourceUrl = fileText.match(/\[(https?:\/\/[^\s\]]+)/)?.[1] ?? null;
    section.members.push(createMember(fileName, extractTitle(line, fileName, fileStart), sourceUrl));
  }
}

function appendCreatorLines(section: VotingSectionBuilder, line: string): void {
  if (!line.includes("'''Creator:'''") && !line.includes("'''C")) {
    return;
  }

  for (const match of line.matchAll(/\[\[User:([^|\]]+)/gi)) {
    const creator = match[1]?.trim();
    if (creator) {
      section.creatorLines.push(creator);
    }
  }
}

function parseVote(section: VotingSectionBuilder, line: string): void {
  const awardText = substr(/\{\{(\d)\/3\*\}\}/, line);
  const award = Number(awardText);
  if (award !== 0 && award !== 1 && award !== 2 && award !== 3) {
    return;
  }

  const voter = line.includes("[[Special:Contributions/")
    ? substr(/\[\[Special:Contributions\/([^|\]]+)/, line)
    : substr(/\[\[(?:[Uu]ser|[Bb]enutzer|[Uu]suario):([^|\]]+)/, line);
  const normalizedLine = line.replace('<span class="signature-talk">{{int:Talkpagelinktext}}</span>', "");
  section.votes.push({
    num: section.num,
    award: award as 0 | 1 | 2 | 3,
    voter,
    line: normalizedLine,
    timestamp: extractSignatureTimestamp(normalizedLine)
  });
}

function inferEntryMode(sections: VotingSectionBuilder[]): EntryMode {
  let single = 0;
  let duoCoequal = 0;
  let duoReference = 0;

  for (const section of sections) {
    if (section.members.length >= 2 && section.creatorLines.length >= 2) {
      duoCoequal += 1;
    } else if (section.members.length >= 2) {
      duoReference += 1;
    } else {
      single += 1;
    }
  }

  if (duoCoequal > 0 && duoCoequal >= single && duoCoequal >= duoReference) {
    return "duo-coequal";
  }
  if (duoReference > 0 && duoReference >= single) {
    return "duo-reference";
  }
  return "single";
}

function applyEntryMode(section: VotingSectionBuilder, mode: EntryMode): VotingEntry {
  const members = section.members.map((member, index) => ({
    ...member,
    role: mode === "duo-reference" && index === 0 ? "reference" as const : "submission" as const,
    user: mode === "duo-reference"
      ? (index === 0 ? null : section.creatorLines.at(-1) ?? null)
      : section.creatorLines[index] ?? section.creatorLines[0] ?? null
  }));

  if (mode === "duo-reference" && members.length === 1) {
    members.push(createEmptyMember("submission"));
  }
  if (mode === "duo-coequal" && members.length === 1) {
    members.push(createEmptyMember("submission"));
  }

  return { num: section.num, mode, members };
}

function getEntryCreator(entry: VotingEntry): string {
  const submission = entry.members.find((member) => member.role === "submission");
  return submission?.user ?? "";
}

function projectVotingFiles(entries: VotingEntry[]): VotingFile[] {
  return entries.flatMap((entry) => {
    const member = entry.members.find((candidate) => candidate.role === "submission" && candidate.fileName);
    return entry.num && member?.fileName
      ? [{ num: entry.num, fileName: member.fileName, title: member.title, creator: getEntryCreator(entry) }]
      : [];
  });
}

export function parseVotingChallenges(wikiText: string): VotingChallenge[] {
  const cleaned = stripComments(wikiText);
  const matches = cleaned.matchAll(/Commons:Photo challenge\/([^/]+)\/Voting/g);
  const seen = new Set<string>();
  const challenges: VotingChallenge[] = [];

  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw || seen.has(raw)) {
      continue;
    }

    seen.add(raw);
    challenges.push({ raw });
  }

  return challenges;
}

export function parseVotingPage(wikiText: string): ParsedVotingPage {
  const sections: VotingSectionBuilder[] = [];
  let section: VotingSectionBuilder | null = null;
  let inComment = false;

  for (const rawLine of wikiText.split(/\r?\n/)) {
    const repairedLine = repairVoteBelowMarker(rawLine);
    const visible = stripCommentsFromLine(repairedLine, inComment);
    inComment = visible.endsInComment;
    const line = visible.text.trim();
    const metadataLine = repairedLine.trim();

    if (line.startsWith("===")) {
      if (section) {
        sections.push(section);
      }
      section = {
        num: extractSectionNumber(line),
        members: [],
        creatorLines: [],
        votes: []
      };
      continue;
    }

    if (!section || section.num <= 0) {
      continue;
    }

    if (line.includes("[[File:")) {
      appendFileMembers(section, line);
    }
    // Voting pages intentionally keep creator metadata inside inline comments.
    appendCreatorLines(section, metadataLine);
    if (line.includes("/3*}}") && !isUnexpandedVotePlaceholder(line)) {
      parseVote(section, line);
    }
  }

  if (section) {
    sections.push(section);
  }

  const numberedSections = sections.filter((candidate) => candidate.num > 0);
  const entryMode = inferEntryMode(numberedSections);
  const entries = numberedSections.map((candidate) => applyEntryMode(candidate, entryMode));
  const votes = numberedSections.flatMap((candidate, index) => {
    const creator = getEntryCreator(entries[index]);
    return candidate.votes.map((vote) => ({ ...vote, creator }));
  });
  const issues = entries.flatMap((entry) => {
    if (entryMode !== "single" && entry.members.some((member) => member.displayKind === "empty")) {
      return [{ num: entry.num ?? 0, message: `Entry #${entry.num ?? "?"} contains an empty archived member.` }];
    }
    return [];
  });

  return { entryMode, entries, files: projectVotingFiles(entries), votes, issues };
}
