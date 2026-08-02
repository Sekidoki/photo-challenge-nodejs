export type JobStatus = "queued" | "running" | "failed" | "completed";

export type PublishMode = "dry-run" | "sandbox" | "live";

export type WritablePublishMode = Exclude<PublishMode, "dry-run">;

export type EntryMode = "single" | "duo-coequal" | "duo-reference";

export type SourcePageVariant = "main" | "old";

export type JobAction =
  | "create-voting"
  | "count-votes-and-select-winners"
  | "archive-pages"
  | "build-voting-index"
  | "post-results-maintenance";

export type LegacyJobAction = "process-challenge";

export type ListAction = "list-submitted-challenges" | "list-voting-challenges";

export type SubmissionWindow = {
  startsAt: string;
  endsAt: string;
};

export type VotingEntryMemberRole = "submission" | "reference";

export type VotingEntryMember = {
  role: VotingEntryMemberRole;
  fileName: string | null;
  title: string;
  sourceUrl?: string | null;
  displayKind?: "commons-file" | "placeholder" | "empty";
  user: string | null;
  uploaded: string | null;
  width: number | null;
  height: number | null;
  comment: string | null;
  ownWork: boolean;
  exists: boolean;
  active: boolean;
};

export type VotingEntry = {
  num?: number;
  mode: EntryMode;
  members: VotingEntryMember[];
};

export type ScoredVotingEntry = {
  num: number;
  mode: EntryMode;
  members: Array<{
    role: VotingEntryMemberRole;
    fileName: string;
    title: string;
    creator: string;
  }>;
  creator: string;
  score: number;
  support: number;
  rank: number;
};

export type BotCredentials = {
  name: string;
  botPassword: string;
  /** Short-lived Wikimedia OAuth 2 access token used by the Web UI. Never persist this value in job logs. */
  oauthAccessToken?: string;
};

export type JobRequest = {
  action: JobAction;
  challenge: string;
  pairedChallenge?: string;
  entryMode?: EntryMode;
  submissionWindow?: SubmissionWindow;
  /** "main" reads the live page; "old" reads the *_old archived copy. Applies to list-* and build-voting-index. */
  source?: SourcePageVariant;
  credentials: BotCredentials;
  publishMode: PublishMode;
};

export type JobProgress = {
  id: string;
  status: JobStatus;
  currentStep: string;
  percent: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  messages: string[];
  outputDir: string;
  action: string;
  challenge: string;
  publishMode: PublishMode;
  loginName: string;
  errorMessage: string | null;
};
