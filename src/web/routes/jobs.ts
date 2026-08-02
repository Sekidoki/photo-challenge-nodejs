import { Router } from "express";
import { getOAuthSession, isOAuthConfigured } from "../oauth-session.js";
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

jobsRouter.use(async (request, response, next) => {
  if (!isOAuthConfigured()) {
    next();
    return;
  }
  try {
    const session = await getOAuthSession(request, response);
    if (!session) {
      const returnTo = encodeURIComponent(request.originalUrl || request.url);
      response.redirect(`/auth/login?returnTo=${returnTo}`);
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
});

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
