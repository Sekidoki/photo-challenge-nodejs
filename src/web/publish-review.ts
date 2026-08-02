import type { JobProgress } from "../core/models.js";
import { resolvePublishTarget } from "../workflows/run-job.js";
import { createTranslator, type Translator } from "./i18n.js";

type PublishArtifactType = "voting" | "result" | "winners" | "revised";
type PublishTargetType = "voting" | "result" | "winners";

type DiffKind = "same" | "add" | "remove" | "change" | "skip";

export type PublishableArtifact = {
  type: PublishArtifactType;
  label: string;
  fileName: string;
  content: string;
  targetType: PublishTargetType;
  targetTitle: string;
};

export type PublishDiffRow = {
  kind: DiffKind;
  currentLineNumber: number | null;
  nextLineNumber: number | null;
  currentText: string;
  nextText: string;
  isSame: boolean;
  isAdd: boolean;
  isRemove: boolean;
  isChange: boolean;
  isSkip: boolean;
};

export type PublishDiffSummary = {
  status: "new" | "same" | "changed";
  currentLineCount: number;
  nextLineCount: number;
  changedLineCount: number;
  firstDifferenceLine: number | null;
  currentSnippet: string[];
  nextSnippet: string[];
  rows: PublishDiffRow[];
};

const artifactDefinitions: Array<{
  type: PublishArtifactType;
  suffix: string;
  labelKey: string;
  targetType: PublishTargetType;
}> = [
  { type: "voting", suffix: "_voting.txt", labelKey: "coreArtifact.voting.label", targetType: "voting" },
  { type: "revised", suffix: "_revised.txt", labelKey: "coreArtifact.revised.label", targetType: "voting" },
  { type: "result", suffix: "_result.txt", labelKey: "coreArtifact.result.label", targetType: "result" },
  { type: "winners", suffix: "_winners.txt", labelKey: "coreArtifact.winners.label", targetType: "winners" }
];

const LOOKAHEAD = 3;
const CONTEXT_LINES = 2;

export function buildPublishableArtifacts(
  job: JobProgress,
  generatedFiles: Array<{ name: string; content: string }>,
  mode: "sandbox" | "live",
  t: Translator = createTranslator("en")
): PublishableArtifact[] {
  const artifacts = artifactDefinitions.flatMap((definition) => {
    const file = generatedFiles.find((entry) => entry.name.endsWith(definition.suffix));
    if (!file) return [];

    return [{
      type: definition.type,
      label: t(definition.labelKey),
      fileName: file.name,
      content: file.content,
      targetType: definition.targetType,
      targetTitle: resolvePublishTarget(job.loginName, job.challenge, definition.targetType, mode)
    }];
  });

  if (artifacts.some((artifact) => artifact.type === "revised")) {
    return artifacts.filter((artifact) => artifact.type !== "voting");
  }

  return artifacts;
}

export function summarizePublishDiff(
  currentContent: string | null,
  nextContent: string,
  t: Translator = createTranslator("en")
): PublishDiffSummary {
  const normalizedCurrent = normalizeContent(currentContent);
  const normalizedNext = normalizeContent(nextContent);
  const currentLines = splitLines(normalizedCurrent);
  const nextLines = splitLines(normalizedNext);
  const allRows = buildLineDiffRows(currentLines, nextLines);
  const rows = compressDiffRows(allRows, t);

  if (normalizedCurrent === null) {
    return {
      status: "new",
      currentLineCount: 0,
      nextLineCount: nextLines.length,
      changedLineCount: nextLines.length,
      firstDifferenceLine: 1,
      currentSnippet: [],
      nextSnippet: nextLines.slice(0, 5),
      rows
    };
  }

  if (normalizedCurrent === normalizedNext) {
    return {
      status: "same",
      currentLineCount: currentLines.length,
      nextLineCount: nextLines.length,
      changedLineCount: 0,
      firstDifferenceLine: null,
      currentSnippet: currentLines.slice(0, 3),
      nextSnippet: nextLines.slice(0, 3),
      rows
    };
  }

  const maxLength = Math.max(currentLines.length, nextLines.length);
  let firstDifferenceIndex = 0;
  let changedLineCount = 0;

  for (let index = 0; index < maxLength; index += 1) {
    if (currentLines[index] !== nextLines[index]) {
      if (changedLineCount === 0) {
        firstDifferenceIndex = index;
      }
      changedLineCount += 1;
    }
  }

  return {
    status: "changed",
    currentLineCount: currentLines.length,
    nextLineCount: nextLines.length,
    changedLineCount,
    firstDifferenceLine: firstDifferenceIndex + 1,
    currentSnippet: currentLines.slice(firstDifferenceIndex, firstDifferenceIndex + 5),
    nextSnippet: nextLines.slice(firstDifferenceIndex, firstDifferenceIndex + 5),
    rows
  };
}

function normalizeContent(content: string | null): string | null {
  if (content === null) return null;
  return content.replace(/\r\n/g, "\n").replace(/\s+$/u, "");
}

function splitLines(content: string | null): string[] {
  if (!content) return [];
  return content.split("\n");
}

function buildLineDiffRows(currentLines: string[], nextLines: string[]): PublishDiffRow[] {
  const rows: PublishDiffRow[] = [];
  let currentIndex = 0;
  let nextIndex = 0;

  while (currentIndex < currentLines.length || nextIndex < nextLines.length) {
    const currentLine = currentLines[currentIndex];
    const nextLine = nextLines[nextIndex];

    if (currentIndex >= currentLines.length) {
      rows.push(makeRow("add", null, nextIndex + 1, "", nextLine ?? ""));
      nextIndex += 1;
      continue;
    }

    if (nextIndex >= nextLines.length) {
      rows.push(makeRow("remove", currentIndex + 1, null, currentLine ?? "", ""));
      currentIndex += 1;
      continue;
    }

    if (currentLine === nextLine) {
      rows.push(makeRow("same", currentIndex + 1, nextIndex + 1, currentLine, nextLine));
      currentIndex += 1;
      nextIndex += 1;
      continue;
    }

    const currentJump = findAhead(currentLines, currentIndex + 1, nextLine);
    const nextJump = findAhead(nextLines, nextIndex + 1, currentLine);

    if (currentJump >= 0 && (nextJump < 0 || currentJump <= nextJump)) {
      rows.push(makeRow("remove", currentIndex + 1, null, currentLine, ""));
      currentIndex += 1;
      continue;
    }

    if (nextJump >= 0) {
      rows.push(makeRow("add", null, nextIndex + 1, "", nextLine));
      nextIndex += 1;
      continue;
    }

    rows.push(makeRow("change", currentIndex + 1, nextIndex + 1, currentLine, nextLine));
    currentIndex += 1;
    nextIndex += 1;
  }

  return rows;
}

function findAhead(lines: string[], startIndex: number, needle: string | undefined): number {
  if (typeof needle !== "string") return -1;

  for (let offset = 0; offset < LOOKAHEAD; offset += 1) {
    const index = startIndex + offset;
    if (lines[index] === needle) {
      return offset;
    }
  }

  return -1;
}

function compressDiffRows(rows: PublishDiffRow[], t: Translator): PublishDiffRow[] {
  const changedIndices = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.kind !== "same")
    .map(({ index }) => index);

  if (changedIndices.length === 0) {
    return rows.slice(0, Math.min(rows.length, 12));
  }

  const keep = new Set<number>();
  for (const changedIndex of changedIndices) {
    const start = Math.max(0, changedIndex - CONTEXT_LINES);
    const end = Math.min(rows.length - 1, changedIndex + CONTEXT_LINES);
    for (let index = start; index <= end; index += 1) {
      keep.add(index);
    }
  }

  const result: PublishDiffRow[] = [];
  let skipping = false;

  for (let index = 0; index < rows.length; index += 1) {
    if (keep.has(index)) {
      skipping = false;
      result.push(rows[index]);
      continue;
    }

    if (!skipping) {
      result.push(makeRow("skip", null, null, "", t("review.diff.omitted")));
      skipping = true;
    }
  }

  return result;
}

function makeRow(
  kind: DiffKind,
  currentLineNumber: number | null,
  nextLineNumber: number | null,
  currentText: string,
  nextText: string
): PublishDiffRow {
  return {
    kind,
    currentLineNumber,
    nextLineNumber,
    currentText,
    nextText,
    isSame: kind === "same",
    isAdd: kind === "add",
    isRemove: kind === "remove",
    isChange: kind === "change",
    isSkip: kind === "skip"
  };
}
