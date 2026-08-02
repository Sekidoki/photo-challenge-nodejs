import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { LEGACY_VOTE_COUNTING_ACTION, VOTE_COUNTING_ACTION } from "../core/job-actions.js";
import { getJobOutputPaths } from "../infra/output-paths.js";
import { createTranslator, type Translator } from "./i18n.js";

export type ArtifactKind = "generated" | "logs";

export type ArtifactEntry = {
  name: string;
  kind: ArtifactKind;
  previewUrl: string;
  downloadUrl: string;
};

export type CoreArtifactType = "voting" | "result" | "winners" | "revised" | "maintenance-plan" | "notifications" | "announcement" | "previous-page" | "file-assessments";

export type CoreArtifactEntry = ArtifactEntry & {
  type: CoreArtifactType;
  label: string;
  description: string;
  isActive?: boolean;
};

const voteCountingArtifactDefinitions: Array<{
  type: CoreArtifactType;
  suffix: string;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    type: "result",
    suffix: "_result.txt",
    labelKey: "coreArtifact.result.label",
    descriptionKey: "coreArtifact.result.description"
  },
  {
    type: "winners",
    suffix: "_winners.txt",
    labelKey: "coreArtifact.winners.label",
    descriptionKey: "coreArtifact.winners.description"
  },
  {
    type: "revised",
    suffix: "_revised.txt",
    labelKey: "coreArtifact.revised.label",
    descriptionKey: "coreArtifact.revised.description"
  }
];

const workflowArtifactDefinitions: Record<string, Array<{
  type: CoreArtifactType;
  suffix: string;
  labelKey: string;
  descriptionKey: string;
}>> = {
  "create-voting": [
    {
      type: "voting",
      suffix: "_voting.txt",
      labelKey: "coreArtifact.voting.label",
      descriptionKey: "coreArtifact.voting.description"
    }
  ],
  [VOTE_COUNTING_ACTION]: voteCountingArtifactDefinitions,
  [LEGACY_VOTE_COUNTING_ACTION]: voteCountingArtifactDefinitions,
  "post-results-maintenance": [
    {
      type: "maintenance-plan",
      suffix: "_maintenance_plan.json",
      labelKey: "maintenanceArtifact.plan.label",
      descriptionKey: "maintenanceArtifact.plan.description"
    },
    {
      type: "notifications",
      suffix: "_winner_notifications.txt",
      labelKey: "maintenanceArtifact.notifications.label",
      descriptionKey: "maintenanceArtifact.notifications.description"
    },
    {
      type: "announcement",
      suffix: "_challenge_announcement.txt",
      labelKey: "maintenanceArtifact.announcement.label",
      descriptionKey: "maintenanceArtifact.announcement.description"
    },
    {
      type: "previous-page",
      suffix: "_previous_page_update.txt",
      labelKey: "maintenanceArtifact.previous.label",
      descriptionKey: "maintenanceArtifact.previous.description"
    },
    {
      type: "file-assessments",
      suffix: "_file_assessments.json",
      labelKey: "maintenanceArtifact.assessments.label",
      descriptionKey: "maintenanceArtifact.assessments.description"
    }
  ]
};

export function getArtifactName(value: string | string[] | undefined): string {
  const name = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return "";
  }
  return name;
}

export function getArtifactKind(value: string | string[] | undefined): ArtifactKind | null {
  const kind = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  return kind === "generated" || kind === "logs" ? kind : null;
}

export async function loadGeneratedFiles(jobId: string): Promise<Array<{ name: string; content: string }>> {
  const paths = getJobOutputPaths(jobId);
  const names = await safeReadDir(paths.generatedDir);
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      content: await readFile(path.join(paths.generatedDir, name), "utf8")
    }))
  );
  return files;
}

export async function loadCoreArtifacts(
  jobId: string,
  action: string,
  activeFileName?: string,
  t: Translator = createTranslator("en")
): Promise<CoreArtifactEntry[]> {
  const artifacts = await listArtifacts(jobId);
  const { coreArtifacts } = classifyGeneratedArtifacts(artifacts.generated, action, t);

  return coreArtifacts.map((artifact) => ({
    ...artifact,
    isActive: artifact.name === activeFileName
  }));
}

export async function listArtifacts(jobId: string): Promise<{ generated: ArtifactEntry[]; logs: ArtifactEntry[] }> {
  const paths = getJobOutputPaths(jobId);
  const generated = await safeReadDir(paths.generatedDir);
  const logs = await safeReadDir(paths.logsDir);

  return {
    generated: generated.map((name) => toArtifactEntry(jobId, "generated", name)),
    logs: logs.map((name) => toArtifactEntry(jobId, "logs", name))
  };
}

export function classifyGeneratedArtifacts(
  generated: ArtifactEntry[],
  action: string,
  t: Translator = createTranslator("en")
): {
  coreArtifacts: CoreArtifactEntry[];
  otherGeneratedFiles: ArtifactEntry[];
} {
  const definitions = workflowArtifactDefinitions[action] ?? [];
  const usedNames = new Set<string>();
  const coreArtifacts = definitions.flatMap((definition) => {
    const match = generated.find((artifact) => artifact.name.endsWith(definition.suffix));
    if (!match) {
      return [];
    }

    usedNames.add(match.name);
    return [
      {
        ...match,
        type: definition.type,
        label: t(definition.labelKey),
        description: t(definition.descriptionKey)
      }
    ];
  });

  return {
    coreArtifacts,
    otherGeneratedFiles: generated.filter((artifact) => !usedNames.has(artifact.name))
  };
}

export function resolveArtifactPath(jobId: string, kind: ArtifactKind, fileName: string): string | null {
  const paths = getJobOutputPaths(jobId);
  const baseDir = kind === "generated" ? paths.generatedDir : paths.logsDir;
  const resolved = path.resolve(baseDir, fileName);
  const root = path.resolve(baseDir);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return null;
  }
  return resolved;
}

function toArtifactEntry(jobId: string, kind: ArtifactKind, name: string): ArtifactEntry {
  const encodedName = encodeURIComponent(name);
  return {
    name,
    kind,
    previewUrl: `/jobs/${jobId}/artifacts/${kind}/${encodedName}`,
    downloadUrl: `/jobs/${jobId}/artifacts/${kind}/${encodedName}/download`
  };
}

async function safeReadDir(targetPath: string): Promise<string[]> {
  try {
    return await readdir(targetPath);
  } catch {
    return [];
  }
}
