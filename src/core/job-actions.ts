import { DateTime } from "luxon";
import type {
  BotCredentials,
  EntryMode,
  JobAction,
  JobRequest,
  LegacyJobAction,
  ListAction,
  PublishMode,
  SourcePageVariant,
  SubmissionWindow
} from "./models.js";

export const DEFAULT_JOB_ACTION: JobAction = "count-votes-and-select-winners";
export const VOTE_COUNTING_ACTION: JobAction = "count-votes-and-select-winners";
export const LEGACY_VOTE_COUNTING_ACTION: LegacyJobAction = "process-challenge";

export const JOB_ACTIONS: readonly JobAction[] = [
  "create-voting",
  VOTE_COUNTING_ACTION,
  "archive-pages",
  "build-voting-index",
  "post-results-maintenance"
];

export const LIST_ACTIONS: readonly ListAction[] = [
  "list-submitted-challenges",
  "list-voting-challenges"
];

export const PUBLISH_MODES: readonly PublishMode[] = ["dry-run", "sandbox", "live"];
export const ENTRY_MODES: readonly EntryMode[] = ["single", "duo-coequal", "duo-reference"];
export const SOURCE_PAGE_VARIANTS: readonly SourcePageVariant[] = ["main", "old"];

export type JobRequestInput = {
  action: string;
  challenge?: string;
  pairedChallenge?: string;
  entryMode?: string;
  submissionWindow?: SubmissionWindow;
  source?: string;
  credentials: BotCredentials;
  publishMode?: string;
};

type ValidationLabels = {
  publishMode?: string;
  entryMode?: string;
  source?: string;
};

export function isJobAction(value: string): value is JobAction {
  return (JOB_ACTIONS as readonly string[]).includes(value);
}

export function isListAction(value: string): value is ListAction {
  return (LIST_ACTIONS as readonly string[]).includes(value);
}

export function isVoteCountingAction(action: string): action is JobAction | LegacyJobAction {
  return action === VOTE_COUNTING_ACTION || action === LEGACY_VOTE_COUNTING_ACTION;
}

export function isChallengeRequiredAction(action: JobAction): boolean {
  return action === "create-voting" || action === VOTE_COUNTING_ACTION || action === "post-results-maintenance";
}

export function getJobActionLabel(action: string): string {
  if (action === "create-voting") {
    return "Prepare voting page";
  }

  if (isVoteCountingAction(action)) {
    return "Count votes and select winners";
  }

  if (action === "post-results-maintenance") {
    return "Run post-results maintenance";
  }

  return action;
}

export function parseJobAction(value: string): JobAction {
  if (isJobAction(value)) {
    return value;
  }

  throw new Error(`Unknown command: ${value}`);
}

export function parseListAction(value: string): ListAction {
  if (isListAction(value)) {
    return value;
  }

  throw new Error(`Unknown command: ${value}`);
}

export function parsePublishMode(value: string, label = "--publish-mode"): PublishMode {
  if ((PUBLISH_MODES as readonly string[]).includes(value)) {
    return value as PublishMode;
  }

  throw new Error(`Invalid ${label} "${value}". Must be dry-run, sandbox, or live.`);
}

export function parseEntryMode(value: string, label = "--entry-mode"): EntryMode {
  if ((ENTRY_MODES as readonly string[]).includes(value)) {
    return value as EntryMode;
  }

  throw new Error(`Invalid ${label} "${value}". Must be single, duo-coequal, or duo-reference.`);
}

export function parseSourcePageVariant(value: string, label = "--source"): SourcePageVariant {
  if ((SOURCE_PAGE_VARIANTS as readonly string[]).includes(value)) {
    return value as SourcePageVariant;
  }

  throw new Error(`Invalid ${label} "${value}". Must be main or old.`);
}

export function parseSubmissionWindowValues(
  startsAt: string,
  endsAt: string,
  messages = {
    partial: "Submission start and submission end must be provided together.",
    invalid: "Submission window must use valid ISO date/times with start earlier than end."
  }
): SubmissionWindow | undefined {
  if (!startsAt && !endsAt) return undefined;
  if (!startsAt || !endsAt) {
    throw new Error(messages.partial);
  }

  const start = DateTime.fromISO(startsAt, { setZone: true });
  const end = DateTime.fromISO(endsAt, { setZone: true });
  if (!start.isValid || !end.isValid || start >= end) {
    throw new Error(messages.invalid);
  }

  return { startsAt, endsAt };
}

export function buildValidatedJobRequest(input: JobRequestInput, labels: ValidationLabels = {}): JobRequest {
  const action = parseJobAction(input.action);
  const challenge = input.challenge?.trim() ?? "";
  const pairedChallenge = input.pairedChallenge?.trim() ?? "";

  if (isChallengeRequiredAction(action) && !challenge) {
    throw new Error("Missing required --challenge value.");
  }

  return {
    action,
    challenge,
    pairedChallenge: pairedChallenge || undefined,
    entryMode: parseEntryMode(input.entryMode?.trim() ?? "single", labels.entryMode ?? "--entry-mode"),
    submissionWindow: input.submissionWindow,
    source: parseSourcePageVariant(input.source?.trim() ?? "old", labels.source ?? "--source"),
    credentials: {
      name: input.credentials.name.trim(),
      botPassword: input.credentials.botPassword,
      ...(input.credentials.oauthAccessToken
        ? { oauthAccessToken: input.credentials.oauthAccessToken }
        : {})
    },
    publishMode: parsePublishMode(input.publishMode?.trim() ?? "dry-run", labels.publishMode ?? "--publish-mode")
  };
}
