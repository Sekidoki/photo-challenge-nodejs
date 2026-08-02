# Photo Challenge Node.js 架構文件

[English](architecture.md) | 臺灣正體中文

本文件是 Photo Challenge Node.js 的正式架構說明。它定義目前程式的主要分層、資料流、責任邊界、相容性政策與測試策略，作為後續維護與擴充的依據。

## 1. 系統目的

Photo Challenge Node.js 用於支援 Wikimedia Commons Photo Challenge 的例行作業。系統同時提供 Web UI 與 CLI，涵蓋下列工作：

- 從 submission pages 產生 voting page。
- 計票、驗票，並產生 revised voting、result、winners 頁面。
- 在得獎結果確定後產生與發布 maintenance edits，包括得獎通知、central announcement、Previous-page update 與 file assessment templates。

架構上的首要原則是不改變 Commons wikitext 輸出行為。parser、renderer 與 scoring 的輸出屬於高相容性表面，任何調整都必須由 fixtures 或 regression tests 保護。

## 2. 目錄分層

主要目錄責任如下：

- `src/core/`：跨 Web、CLI、workflow 共用的型別、workflow action metadata 與 request validation helper。這層不依賴 Web、Commons bot 或檔案輸出。
- `src/parsers/`：解析 Commons wikitext、submission pages、voting pages 與 challenge index。這層保持純資料轉換，不寫檔、不呼叫 Commons API。
- `src/renderers/`：產生 voting、revised voting、result、winners、voting index 等 wikitext。輸出格式由 regression tests 保護。
- `src/workflows/`：工作流程 orchestration、artifact persistence、publish target resolution、post-results maintenance plan、publish service。
- `src/infra/`：設定、credential store、job store、job history、output path、maintenance publish history 等基礎設施。
- `src/services/`：外部服務 adapter，目前主要是 Wikimedia Commons bot。
- `src/web/`：Express route/controller、Web view model service、artifact service、Handlebars views 與靜態資源。
- `tests/`：focused unit tests 與 workflow fixture tests，保護重構與輸出相容性。

## 3. 入口與資料流

系統有兩個主要入口：

- CLI：`src/cli/index.ts`
- Web：`src/web/app.ts` 與 `src/web/controllers/*`

兩個入口都應使用 `src/core/job-actions.ts` 的共用 validation 與 action metadata。`JobRequest.action` 是 workflow discriminator，新增或移除 workflow action 時，必須同步更新 core metadata、CLI parsing、Web form/view model 與 tests。

典型資料流：

1. CLI 或 Web 建立 `JobRequest`。
2. `runJob(jobId, request)` 建立 output paths、檢查 publish policy、建立 Commons bot session。
3. `runJob` dispatch 到對應 workflow handler。
4. Workflow 讀取來源頁、呼叫 parser/renderer、寫入 generated artifacts。
5. 若 publish mode 需要寫入 Commons，workflow 或 Web publish route 透過 publish helper/service 保存頁面。
6. Job metadata 寫入 `output/jobs/<job-id>/logs/job.log`，Web 可從 job store 或 persisted job history 重建狀態。

## 4. Workflow 架構

`src/workflows/run-job.ts` 是 job dispatch 與生命週期外殼。它負責：

- 建立固定 output paths。
- 套用 workflow publish policy。
- 建立 Commons bot session。
- 依 `JobRequest.action` dispatch 到 workflow handler。
- 統一處理完成、失敗、job log 與 job store 狀態。

具體 workflow 邏輯放在獨立 handler：

- `create-voting.ts`：從 submission pages 產生 voting page 與相關 artifacts。
- `count-votes-and-select-winners.ts`：讀取 voting page、驗票、計票，並產生 revised/result/winners artifacts。
- `archive-pages.ts`：封存挑戰相關頁面。
- `build-voting-index.ts`：產生 voting index section。
- `run-post-results-maintenance.ts`：建立 post-results maintenance plan 與相關文字/JSON artifacts。

共用 orchestration helper 放在 `job-runner-support.ts`：

- source page loading。
- common artifacts persistence。
- challenge config persistence。
- publish target resolution。
- dry-run、sandbox、live page publish helper。
- job finalization 與 failed job log。

新增 workflow 時，優先新增獨立 handler，讓 `run-job.ts` 只增加 dispatch 分支與必要 policy。

## 5. Publish 架構

`src/workflows/publish-service.ts` 集中 Web manual publish 與 CLI automatic publish 的共同行為：

- `readExistingPageContent`：讀取現有頁面，缺頁回傳 `null`。
- `publishStandardPages`：發布 voting、result、winners 類頁面。
- `publishMaintenanceEditPlans`：發布 maintenance edit plans，包含 live no-op skip、history record 與 publish counts。

Standard publish 的「generated artifact 如何對應 target title」由 workflow helper 與 Web review service 決定。實際保存行為應走 publish service，避免 Web route 與 CLI workflow 各自實作不同 publish 規則。

Maintenance publish 的資料來源是 maintenance plan JSON。`src/workflows/maintenance-publish.ts` 負責：

- `parseMaintenancePlanResult`：runtime schema guard，回傳明確成功/失敗結果。
- `buildMaintenancePublishEntries`：compatibility entry point；遇到 invalid plan 會丟出明確錯誤，CLI automatic publish 會 fail fast。
- `buildMaintenancePublishEntriesFromPlan`：從已驗證 plan 轉成 publish entries。
- `applyMaintenancePublishEntry`：把單一 maintenance entry 套用到目前頁面內容，產生下一版 wikitext。

Web manual publish 先用 `parseMaintenancePlanResult` 顯示 warning/notice，再使用 `buildMaintenancePublishEntriesFromPlan`。CLI automatic publish 直接使用 `buildMaintenancePublishEntries`。

## 6. Web 架構

`src/web/controllers/job-controller.ts` 維持 HTTP controller 角色：

- 解析 request body、query string 與 route params。
- 執行 route guard。
- 解析 credential。
- redirect 與 render。
- 呼叫 workflow、artifact service、review service、publish service。

Controller 不應持有 artifact 分類、diff review、maintenance plan schema validation 或 publish edit plan 組裝邏輯。

Web domain/service 檔案：

- `artifacts.ts`：列出 generated/log artifacts、分類 core artifacts、解析 artifact preview/download path。
- `publish-review.ts`：standard publish artifact selection 與 diff summary。
- `standard-publish-review.ts`：standard publish review view model 與 publish plan。
- `maintenance-review.ts`：maintenance artifacts summary。
- `maintenance-publish-review.ts`：maintenance publish review view model，包含 invalid plan warning 與 live diff review。

Handlebars views 只呈現 view model，不讀檔、不呼叫 Commons、不解析 maintenance plan。

### Web 登入

部署後的 Web UI 使用 Wikimedia OAuth 2 Authorization Code flow 搭配 PKCE。`src/web/oauth-session.ts` 負責 authorization state、token 交換與更新、簽章 cookie、可選的維護者 allowlist，以及 CSRF token。Access/refresh token 只留在伺服器 process，禁止寫入 job log 或 artifact；Web job 只把當下的短期 access token 放進記憶體中的 `JobRequest`。

OAuth 與 BotPassword 刻意分別服務不同入口：

- 啟用 OAuth 時，Web 一律使用目前登入維護者的 Wikimedia 身分。
- CLI 繼續使用 `NAME` 與 `BOT_PASSWORD`。
- 本機 Web 若未設定 OAuth，仍可使用既有 BotPassword 表單。

目前 OAuth session store 位於記憶體，因此 Toolforge Web service 應維持單一 replica。若將來要擴為多 replica，必須先加入共享且加密的 session store。

## 7. Artifact、Job History 與 Publish History

每個 job 使用固定輸出目錄：

```text
output/jobs/<job-id>/
  input/
  generated/
  logs/job.log
```

- `input/`：從 Commons 讀取的來源頁。
- `generated/`：workflow 產生的 wikitext、JSON plan、summary、publish history。
- `logs/job.log`：job history 可重建的最小 metadata。

`src/infra/job-history.ts` 會從 `logs/job.log` 重建過去 job。修改 log 欄位時要考慮舊 job 相容性。

Maintenance publish history 存在 `generated/maintenance_publish_history.json`，由 `publish-service.ts` 透過 `recordMaintenancePublish` 寫入。

## 8. Action 與命名政策

新 job 的 vote-counting action 是 `count-votes-and-select-winners`。舊的 `process-challenge` 只保留給 persisted job 與 artifact compatibility，不應再出現在 UI 或 CLI 新命令中。

共用 action、mode、source、entry validation 放在 `src/core/job-actions.ts`。Web 與 CLI 都應使用這一層，避免同一個 mode 在不同入口有不同 fallback。

公開型別與跨模組函式應避免過度泛用名稱。新增 API 時優先使用能表達 domain 的名稱，例如 `PublishReviewEntry`、`MaintenancePublishEntry`、`ArtifactEntry`、`SourcePageSpec`。

## 9. Sandbox Path 相容性

Maintenance announcement sandbox target 目前仍使用既有路徑：

```text
User:<name>/Sandbox/Photo Challenge talk page Annoucement
```

其中 `Annoucement` 是歷史拼字。暫不直接改為 `Announcement`，避免破壞已存在 sandbox page 與 publish history。若未來要修正，應支援新舊 alias 或提供 migration note。

## 10. 測試策略

重構或新增功能時，優先執行：

```bash
npm run check
npm run check:test
npm test
```

主要測試邊界：

- `job-actions.test.ts`：共用 request validation 與 action metadata。
- `workflow-integration.test.ts`：offline generated artifacts 不變。
- `publish-review.test.ts`、`maintenance-review.test.ts`：Web review service view model。
- `publish-service.test.ts`：publish save、skip、history 行為。
- `maintenance-publish.test.ts`：maintenance plan guard 與 edit application。
- Parser、renderer、scoring tests：保護 Commons wikitext 相容性。

新增或調整 parser/renderer 時，應補 fixture 或 snapshot-like assertions，因為 Commons wikitext 輸出是最重要的相容性表面。
