import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import compression from "compression";
import { create } from "express-handlebars";
import { indexRouter } from "./routes/index.js";
import { jobsRouter } from "./routes/jobs.js";
import { authRouter } from "./routes/auth.js";
import { maintainersRouter } from "./routes/maintainers.js";
import { getOAuthSession, isOAuthConfigured } from "./oauth-session.js";
import { canManageMaintainers } from "../infra/maintainer-registry.js";
import {
  buildLanguageSwitchUrl,
  createTranslator,
  getRequestLocale,
  isSupportedLocale
} from "./i18n.js";

export function createApp() {
  const app = express();
  const publicRoot = path.join(process.cwd(), "src", "web", "public");
  const assetVersion = createHash("sha256")
    .update(["styles.css", "dashboard.js", "progress.js", "rum.js"].map((file) => readFileSync(path.join(publicRoot, file))).join(""))
    .digest("hex").slice(0, 12);
  const handlebars = create({
    extname: ".handlebars",
    helpers: {
      eq(a: unknown, b: unknown) {
        return a === b;
      },
      json(value: unknown) {
        return JSON.stringify(value, null, 2);
      },
      t(key: string, options: { hash?: Record<string, string | number>; data?: { root?: { locale?: unknown } } }) {
        const locale = isSupportedLocale(options.data?.root?.locale) ? options.data.root.locale : "en";
        return createTranslator(locale)(key, options.hash);
      }
    }
  });

  app.engine(".handlebars", handlebars.engine);
  app.set("view engine", ".handlebars");
  app.set("views", path.join(process.cwd(), "src", "web", "views"));

  app.use(compression());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  const staticOptions = { immutable: true, maxAge: "1y" } as const;
  app.use(
    "/static/codex",
    express.static(path.join(process.cwd(), "node_modules", "@wikimedia", "codex-design-tokens"), staticOptions)
  );
  app.use("/static/web-vitals", express.static(path.join(process.cwd(), "node_modules", "web-vitals", "dist"), staticOptions));
  app.use("/static", express.static(publicRoot, staticOptions));

  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.locals.assetVersion = assetVersion;
    next();
  });

  app.use(async (request, response, next) => {
    try {
      const locale = getRequestLocale(request);
      if (isSupportedLocale(request.query.lang)) {
        response.cookie("ui_lang", locale, {
          maxAge: 365 * 24 * 60 * 60 * 1000,
          sameSite: "lax",
          secure: request.secure
        });
      }
      response.locals.locale = locale;
      response.locals.htmlLang = locale;
      response.locals.languageLinks = {
        en: buildLanguageSwitchUrl(request, "en"),
        zhTW: buildLanguageSwitchUrl(request, "zh-TW")
      };
      const oauthSession = await getOAuthSession(request, response);
      response.locals.oauthConfigured = isOAuthConfigured();
      response.locals.oauthUser = oauthSession
        ? {
            name: oauthSession.userName,
            role: oauthSession.role,
            canManageMaintainers: canManageMaintainers(oauthSession.role)
          }
        : null;
      response.locals.csrfToken = oauthSession?.csrfToken ?? "";
      next();
    } catch (error) {
      next(error);
    }
  });

  app.use("/auth", authRouter);
  app.use("/", maintainersRouter);
  app.use("/", indexRouter);
  app.use("/jobs", jobsRouter);

  return app;
}
