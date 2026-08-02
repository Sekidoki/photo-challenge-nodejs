import { Router } from "express";
import { finishOAuthLogin, logoutOAuthSession, startOAuthLogin } from "../controllers/auth-controller.js";

export const authRouter = Router();

authRouter.get("/login", startOAuthLogin);
authRouter.get("/callback", finishOAuthLogin);
authRouter.post("/logout", logoutOAuthSession);
