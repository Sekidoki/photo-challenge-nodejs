import assert from "node:assert/strict";
import type { Request } from "express";
import {
  buildLanguageSwitchUrl,
  createTranslator,
  getRequestLocale
} from "../../src/web/i18n.js";
import { summarizeMaintenanceArtifact } from "../../src/web/maintenance-review.js";
import { summarizePublishDiff } from "../../src/web/publish-review.js";
import { buildDiffSummaryText } from "../../src/web/standard-publish-review.js";
import { test } from "../support/harness.js";

function fakeRequest(options: {
  query?: Record<string, string>;
  cookie?: string;
  acceptLanguage?: string;
  originalUrl?: string;
}): Request {
  return {
    query: options.query ?? {},
    headers: {
      cookie: options.cookie,
      "accept-language": options.acceptLanguage
    },
    originalUrl: options.originalUrl ?? "/"
  } as unknown as Request;
}

test("UI locale prefers a supported query parameter over cookie and Accept-Language", () => {
  const request = fakeRequest({
    query: { lang: "en" },
    cookie: "ui_lang=zh-TW",
    acceptLanguage: "zh-TW,zh;q=0.9"
  });

  assert.equal(getRequestLocale(request), "en");
});

test("UI locale recognizes Traditional Chinese from cookie and Accept-Language", () => {
  assert.equal(getRequestLocale(fakeRequest({ cookie: "ui_lang=zh-TW" })), "zh-TW");
  assert.equal(getRequestLocale(fakeRequest({ acceptLanguage: "zh-Hant;q=0.9,en;q=0.8" })), "zh-TW");
});

test("message catalog translates and interpolates publish safety copy", () => {
  const t = createTranslator("zh-TW");
  assert.equal(t("account.signedInAs", { name: "Example" }), "已登入為 Example");
  assert.match(t("safety.liveWarning"), /正式發布/);
  assert.equal(t("missing.message"), "missing.message");
});

test("review services use the supplied Traditional Chinese translator", () => {
  const t = createTranslator("zh-TW");
  const maintenance = summarizeMaintenanceArtifact(
    "example_winner_notifications.txt",
    "Target: User talk:Example\nHeading: Winner",
    t
  );
  const diff = summarizePublishDiff(null, "first\nsecond");

  assert.equal(maintenance?.label, "得獎者通知");
  assert.equal(maintenance?.summary, "已準備 1 個通知目標。");
  assert.equal(buildDiffSummaryText(diff, t), "此目標頁面尚不存在，將建立 2 行內容。");
});

test("language switch URL preserves the current route and other query parameters", () => {
  const request = fakeRequest({ originalUrl: "/jobs/abc/publish-review?mode=live&lang=en" });
  assert.equal(
    buildLanguageSwitchUrl(request, "zh-TW"),
    "/jobs/abc/publish-review?mode=live&lang=zh-TW"
  );
});
