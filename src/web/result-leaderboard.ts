import { readFile } from "node:fs/promises";
import type { ArtifactEntry } from "./artifacts.js";
import { resolveArtifactPath } from "./artifacts.js";

type ScoredFileMember = {
  role?: unknown;
  fileName?: unknown;
  title?: unknown;
};

type ScoredFileArtifact = {
  fileName?: unknown;
  title?: unknown;
  creator?: unknown;
  score?: unknown;
  rank?: unknown;
  members?: unknown;
};

export type ResultLeaderboardImage = {
  fileName: string;
  title: string;
  fileUrl: string;
  thumbnailUrl: string;
};

export type ResultLeaderboardEntry = {
  rank: number;
  creator: string;
  creatorUrl: string;
  score: number;
  images: ResultLeaderboardImage[];
};

const COMMONS_ROOT = "https://commons.wikimedia.org/wiki";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildCommonsUrl(namespace: "File" | "User", title: string): string {
  return `${COMMONS_ROOT}/${namespace}:${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

function buildImage(fileName: string, title: string): ResultLeaderboardImage {
  return {
    fileName,
    title,
    fileUrl: buildCommonsUrl("File", fileName),
    thumbnailUrl: `${COMMONS_ROOT}/Special:Redirect/file/${encodeURIComponent(fileName)}?width=480`
  };
}

function parseSubmissionImages(file: ScoredFileArtifact): ResultLeaderboardImage[] {
  const fallbackFileName = requiredString(file.fileName);
  const fallbackTitle = requiredString(file.title) ?? fallbackFileName ?? "";
  const members = Array.isArray(file.members) ? file.members : [];
  const submissionImages = members.flatMap((value) => {
    if (!isRecord(value)) return [];
    const member = value as ScoredFileMember;
    const fileName = member.role === "submission" ? requiredString(member.fileName) : null;
    if (!fileName) return [];
    return [buildImage(fileName, requiredString(member.title) ?? fileName)];
  });

  if (submissionImages.length > 0) {
    return submissionImages;
  }
  return fallbackFileName ? [buildImage(fallbackFileName, fallbackTitle)] : [];
}

export function parseResultLeaderboard(content: string): ResultLeaderboardEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((value) => {
    if (!isRecord(value)) return [];
    const file = value as ScoredFileArtifact;
    const rank = finiteNumber(file.rank);
    const score = finiteNumber(file.score);
    const creator = requiredString(file.creator);
    const images = parseSubmissionImages(file);
    if (rank === null || rank < 1 || score === null || !creator || images.length === 0) return [];

    return [{
      rank,
      creator,
      creatorUrl: buildCommonsUrl("User", creator),
      score,
      images
    }];
  }).slice(0, 3);
}

export async function loadResultLeaderboard(
  jobId: string,
  generatedArtifacts: ArtifactEntry[]
): Promise<ResultLeaderboardEntry[]> {
  const filesArtifact = generatedArtifacts.find((artifact) => artifact.name.endsWith("_files.json"));
  if (!filesArtifact) return [];

  const artifactPath = resolveArtifactPath(jobId, "generated", filesArtifact.name);
  if (!artifactPath) return [];

  try {
    return parseResultLeaderboard(await readFile(artifactPath, "utf8"));
  } catch {
    return [];
  }
}
