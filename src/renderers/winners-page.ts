import type { ScoredVotingFile } from "../core/scoring.js";
import type { EntryMode } from "../core/models.js";

function addLineBreaks(sentence: string, maxLength: number): string {
  const words = sentence.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLength) {
      current = next;
    } else {
      if (current) {
        lines.push(current);
      }
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.join(" <br/>");
}

export function renderWinnersPage(files: ScoredVotingFile[], challenge: string): string {
  const mode = inferMode(files);
  return renderWinnersTemplate(files, challenge, mode);
}

function inferMode(files: ScoredVotingFile[]): EntryMode {
  return files.find((file) => file.mode && file.mode !== "single")?.mode ?? "single";
}

function getTheme(challenge: string): string {
  const [, , ...themeParts] = challenge.split(" - ");
  return themeParts.join(" - ");
}

function submissionMembers(file: ScoredVotingFile): Array<{ fileName: string; title: string }> {
  return file.members?.filter((member) => member.role === "submission" && member.fileName) ?? [{
    fileName: file.fileName,
    title: file.title
  }];
}

function referenceMembers(file: ScoredVotingFile): Array<{ fileName: string; title: string }> {
  return file.members?.filter((member) => member.role === "reference" && member.fileName) ?? [];
}

function renderWinnersTemplate(files: ScoredVotingFile[], challenge: string, mode: EntryMode): string {
  const theme = getTheme(challenge);
  const topThree = files.slice(0, 3);
  const lines = [
    "{{Photo challenge winners table",
    `|page     = Photo challenge/${challenge}`,
    `|theme    = ${theme}`
  ];

  if (mode === "single") {
    lines.push("|height   = {{{height|240}}}");
  } else {
    lines.push(`|entry_mode = ${mode}`);
    lines.push("|height     = {{{height|240}}}");
  }

  topThree.forEach((file, index) => {
    const n = index + 1;
    const submissions = submissionMembers(file);

    if (mode === "duo-coequal") {
      const [first, second] = submissions;
      lines.push(`|image_${n}    = ${first?.fileName ?? file.fileName}`);
      lines.push(`|title_${n}    = ${addLineBreaks(first?.title ?? file.title, 40)}`);
      if (second) {
        lines.push(`|image_${n}_2  = ${second.fileName}`);
        lines.push(`|title_${n}_2  = ${addLineBreaks(second.title, 40)}`);
      }
    } else if (mode === "duo-reference") {
      const reference = referenceMembers(file)[0];
      const submission = submissions[0];
      if (reference) {
        lines.push(`|reference_image_${n} = ${reference.fileName}`);
        lines.push(`|reference_title_${n} = ${addLineBreaks(reference.title, 40)}`);
      }
      lines.push(`|image_${n}  = ${submission?.fileName ?? file.fileName}`);
      lines.push(`|title_${n}  = ${addLineBreaks(submission?.title ?? file.title, 40)}`);
    } else {
      lines.push(`|image_${n}  = ${file.fileName}`);
      lines.push(`|title_${n}  = ${addLineBreaks(file.title, 40)}`);
    }

    lines.push(`|author_${n} = ${file.creator}`);
    lines.push(`|score_${n}  = ${file.score}`);
    lines.push(`|rank_${n}   = ${file.rank}`);
    lines.push(`|num_${n}    = ${file.num}`);
  });

  lines.push("}}");
  lines.push("");
  return `${lines.join("\n")}\n`;
}
