import { Router } from "express";
import {
  createJob,
  downloadArtifact,
  getJobStatus,
  publishJobOutputs,
  publishMaintenanceOutputs,
  renderArtifactPreview,
  renderJobProgress,
  renderJobResult,
  renderMaintenanceReview,
  renderPublishReview
} from "../controllers/job-controller.js";

export const jobsRouter = Router();

jobsRouter.post("/", createJob);
jobsRouter.get("/:id", renderJobProgress);
jobsRouter.get("/:id/status", getJobStatus);
jobsRouter.get("/:id/result", renderJobResult);
jobsRouter.get("/:id/maintenance-review", renderMaintenanceReview);
jobsRouter.get("/:id/publish-review", renderPublishReview);
jobsRouter.post("/:id/publish", publishJobOutputs);
jobsRouter.post("/:id/maintenance-publish", publishMaintenanceOutputs);
jobsRouter.get("/:id/artifacts/:kind/:fileName", renderArtifactPreview);
jobsRouter.get("/:id/artifacts/:kind/:fileName/download", downloadArtifact);
