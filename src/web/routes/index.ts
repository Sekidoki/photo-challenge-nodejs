import { Router } from "express";
import { clearSavedCredentialAction, renderHomePage } from "../controllers/home-controller.js";

export const indexRouter = Router();

indexRouter.get("/healthz", (_request, response) => response.status(200).type("text/plain").send("ok"));
indexRouter.get("/", renderHomePage);
indexRouter.post("/credentials/clear", clearSavedCredentialAction);
