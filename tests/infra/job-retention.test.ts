import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  JOB_RETENTION_DAYS,
  removeExpiredJobs
} from "../../src/infra/job-retention.js";
import { test } from "../support/harness.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("removeExpiredJobs removes only job directories older than 30 days", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "photo-challenge-job-retention-"));
  const oldJob = path.join(outputRoot, "old-job");
  const recentJob = path.join(outputRoot, "recent-job");
  const boundaryJob = path.join(outputRoot, "boundary-job");
  const unrelatedFile = path.join(outputRoot, "old-file.txt");
  const now = Date.UTC(2026, 7, 8, 12);

  try {
    await mkdir(oldJob);
    await mkdir(recentJob);
    await mkdir(boundaryJob);
    await writeFile(unrelatedFile, "keep", "utf8");

    await utimes(oldJob, new Date(now - 31 * DAY_MS), new Date(now - 31 * DAY_MS));
    await utimes(recentJob, new Date(now - 29 * DAY_MS), new Date(now - 29 * DAY_MS));
    await utimes(
      boundaryJob,
      new Date(now - JOB_RETENTION_DAYS * DAY_MS),
      new Date(now - JOB_RETENTION_DAYS * DAY_MS)
    );
    await utimes(unrelatedFile, new Date(now - 31 * DAY_MS), new Date(now - 31 * DAY_MS));

    const result = await removeExpiredJobs({ outputRoot, now });

    assert.deepEqual(result.removedJobIds, ["old-job"]);
    assert.deepEqual(result.failures, []);
    await assert.rejects(stat(oldJob), { code: "ENOENT" });
    await stat(recentJob);
    await stat(boundaryJob);
    await stat(unrelatedFile);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("removeExpiredJobs treats a missing jobs root as empty", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "photo-challenge-missing-retention-"));
  const outputRoot = path.join(parent, "jobs");

  try {
    assert.deepEqual(await removeExpiredJobs({ outputRoot }), {
      removedJobIds: [],
      failures: []
    });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
