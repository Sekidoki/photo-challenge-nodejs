import { Router } from "express";
import {
  addOrUpdateMaintainer,
  removeMaintainerAction,
  renderMaintainersPage
} from "../controllers/maintainer-controller.js";

export const maintainersRouter = Router();

maintainersRouter.get("/maintainers", renderMaintainersPage);
maintainersRouter.post("/maintainers", addOrUpdateMaintainer);
maintainersRouter.post("/maintainers/remove", removeMaintainerAction);
