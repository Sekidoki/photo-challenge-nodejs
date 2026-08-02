import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { AuthenticatedWorkflowContext, WorkflowSummary } from "./job-runner-support.js";
import { publishRawPage, updateProgress } from "./job-runner-support.js";
import { jobStore } from "../infra/job-store.js";

export async function runArchivePagesWorkflow({
  bot,
  paths,
  jobId,
  request,
  publishAuditContext
}: AuthenticatedWorkflowContext): Promise<WorkflowSummary> {
  const archivePairs = [
    {
      source: "Commons:Photo challenge/Submitting",
      liveTarget: "Commons:Photo challenge/Submitting_old",
      fileName: "submitting.txt"
    },
    {
      source: "Commons:Photo challenge/Voting",
      liveTarget: "Commons:Photo challenge/Voting_old",
      fileName: "voting.txt"
    }
  ];

  for (let i = 0; i < archivePairs.length; i += 1) {
    const pair = archivePairs[i];
    updateProgress(jobId, {
      percent: 20 + i * 30,
      step: `Archiving ${pair.source}`,
      message: `Reading ${pair.source}`
    });
    const page = await bot.readPage(pair.source);
    await writeFile(path.join(paths.inputDir, pair.fileName), page.content, "utf8");
    jobStore.appendMessage(jobId, `Read ${pair.source} (${page.content.length} chars)`);

    if (request.publishMode === "live") {
      await publishRawPage(bot, jobId, pair.source, pair.liveTarget, page.content, `Photo Challenge bot: archive ${pair.source}`, publishAuditContext);
    }
  }

  updateProgress(jobId, { percent: 88, step: "Publish mode", message: `Publish mode: ${request.publishMode}` });
  return {
    sourceCount: 2,
    challengeCount: 0,
    fileCount: 0,
    voteCount: 0
  };
}
