# 照片挑戰 Node.js 架構文件

[English](architecture.md) | 臺灣正體中文

本文件是照片挑戰 Node.js 的正式架構說明。它定義目前程式的主要分層、資料流、責任邊界、相容性政策與測試策略，作為後續維護與擴充的依據。

## 1. 系統目的

照片挑戰 Node.js 用於支援維基共享資源照片挑戰的例行作業。系統以 Web UI 涵蓋下列工作：

- 從 submission pages 產生 voting page。
- 計票、驗票，並產生 revised voting、result、winners 頁面。
- 在得獎結果確定後產生與發布 maintenance edits，包括得獎通知、central announcement、Previous-page update 與 file assessment templates。

架構上的首要原則是不改變 Commons wikitext 輸出行為。parser、renderer 與 scoring 的輸出屬於高相容性表面，任何調整都必須由 fixtures 或 regression tests 保護。

## 2. 目錄分層

主要目錄責任如下：

- `src/core/`：Web 與 workflow 共用的型別、workflow action metadata 與 request validation helper。這層不依賴 Web、Commons bot 或檔案輸出。
- `src/parsers/`：解析 Commons wikitext、submission pages、voting pages 與 challenge index。這層保持純資料轉換，不寫檔、不呼叫 Commons API。
- `src/renderers/`：產生 voting、revised voting、result、winners、voting index 等 wikitext。輸出格式由 regression tests 保護。
- `src/workflows/`：工作流程 orchestration、artifact persistence、publish target resolution、post-results maintenance plan、publish service。
- `src/infra/`：設定、credential store、job store、job history、output path、maintenance publish history 等基礎設施。
- `src/services/`：外部服務 adapter，目前主要是維基共享資源 bot。
- `src/web/`：Express route/controller、Web view model service、artifact service、Handlebars views 與靜態資源。
- `tests/`：focused unit tests 與 workflow fixture tests，保護重構與輸出相容性。

## 3. 入口與資料流

系統的唯一入口是 `src/web/app.ts` 與 `src/web/controllers/*`。Web 應使用 `src/core/job-actions.ts` 的共用 validation 與 action metadata。`JobRequest.action` 是 workflow discriminator，新增或移除 workflow action 時，必須同步更新 core metadata、Web form/view model 與 tests。

典型資料流：

1. Web 建立 `JobRequest`。
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

`src/workflows/publish-service.ts` 集中 Web publish 的共同行為：

- `readExistingPageContent`：讀取現有頁面，缺頁回傳 `null`。
- `publishStandardPages`：發布 voting、result、winners 類頁面。
- `publishMaintenanceEditPlans`：發布 maintenance edit plans，包含 live no-op skip、history record 與 publish counts。

Standard publish 的「generated artifact 如何對應 target title」由 workflow helper 與 Web review service 決定。實際保存行為應統一走 publish service。

Maintenance publish 的資料來源是 maintenance plan JSON。`src/workflows/maintenance-publish.ts` 負責：

- `parseMaintenancePlanResult`：runtime schema guard，回傳明確成功/失敗結果。
- `buildMaintenancePublishEntries`：保留給內部 workflow 相容性的 entry point；遇到 invalid plan 會丟出明確錯誤。
- `buildMaintenancePublishEntriesFromPlan`：從已驗證 plan 轉成 publish entries。
- `applyMaintenancePublishEntry`：把單一 maintenance entry 套用到目前頁面內容，產生下一版 wikitext。

Web publish 先用 `parseMaintenancePlanResult` 顯示 warning/notice，再使用 `buildMaintenancePublishEntriesFromPlan`。

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

Express + Handlebars 的 server-side rendering 是刻意的架構選擇。本系統主要由表單、工作進度、artifact 檢視與 publish review 組成；全面改成 SPA 會重複維護 client state、API 與錯誤處理，卻不會直接改善 Commons workflow 的正確性。Client-side 行為應採局部漸進增強，以 Codex design tokens 作為 design system；只有真正複雜的互動需要時才導入 Codex component runtime。Web UI 的 Codex CSS 由已安裝且固定版本的套件透過本機 static route 提供，不依賴第三方 CDN；停用 JavaScript 時，完整表單仍可使用。

### Web 登入

部署後的 Web UI 使用維基媒體 OAuth 2 Authorization Code flow 搭配 PKCE。`src/web/oauth-session.ts` 負責 authorization state、token 交換與更新、簽章 cookie、維護者授權，以及 CSRF token。Access/refresh token 只留在伺服器 process，禁止寫入 job log 或 artifact；Web job 只把當下的短期 access token 放進記憶體中的 `JobRequest`。

維護者授權採 fail-closed，並持久保存於 `output/config/maintainers.json`。Registry schema v2 會把唯一一筆受保護的 `owner` 與 manager、maintainer 一起放在同一個 `maintainers` array。Registry 不存在時由版本控制內的 `config/maintainers.bootstrap.json` 初始化；舊 v1 registry 也從該 bootstrap 清單取得 owner，並在下一次名單異動時寫成 v2。擁有者不能透過 Web UI 變更；擁有者可以授予或撤銷名單管理員及一般維護者，名單管理員只能新增或移除一般維護者，不能變更擁有者或其他名單管理員。每個已驗證請求都會重新檢查角色，因此移除權限後，既有 session 會在下一次請求失效。替換 owner 是明確的營運操作：service 停止期間修改持久 registry，並在同一次 review 中同步更新作為 recovery source 的 bootstrap file。

`WEB_AUTH_MODE` 明確區隔驗證模式：

- `oauth` 用於 Toolforge 與其他正式部署，Web 一律使用目前登入維護者的維基媒體身分；必要 OAuth 設定不完整時服務拒絕啟動。
- `local` 僅供開發者工作站使用既有 BotPassword 表單，server 只監聽 `127.0.0.1`；Toolforge 或 production 明確誤設為此模式也會拒絕啟動。
- `NODE_ENV=production` 或存在 `TOOL_DATA_DIR` 時，未明確設定也會安全地預設為 `oauth`，不會退回 BotPassword。

目前 OAuth session store 位於記憶體，因此 Toolforge Web service 應維持單一 replica。若將來要擴為多 replica，必須先加入共享且加密的 session store。

Production OAuth consumer 是在 Meta-Wiki 註冊的 confidential OAuth 2 application，只適用於維基共享資源，callback 必須精確為 `https://photo-challenge.toolforge.org/auth/callback`。它使用 authorization-code 與 refresh-token grants，且只申請 workflow 所需的頁面編輯權限。公開 consumer 說明必須列出工具用途、source repository、資料保存方式與 sandbox/live review 流程。

`oauth-http.test.ts` 會從 HTTP 邊界驗證 OAuth callback、CSRF 拒絕與 access-token refresh。OAuth 登入或 refresh 失敗只會產生已定型的 operational event，不記錄原始錯誤、token、完整 user agent 或 IP。

## 7. Artifact、Job History 與 Publish History

每個 job 使用固定輸出目錄：

```text
output/jobs/<job-id>/
  input/
  generated/
  logs/job.log
  logs/publish-audit.jsonl
```

- `input/`：從 Commons 讀取的來源頁。
- `generated/`：workflow 產生的 wikitext、JSON plan、summary、publish history。
- `logs/job.log`：job history 可重建的最小 metadata。
- `logs/publish-audit.jsonl`：append-only 的 publish 成功、失敗與 no-op skip 結構化紀錄。欄位包含操作者、OAuth consumer、模式、目標、revision ID、時間、workflow 與結果，但不包含憑證或 OAuth token。

`src/infra/job-history.ts` 會從 `logs/job.log` 重建過去 job。修改 log 欄位時要考慮舊 job 相容性。

OAuth 模式以 `JobProgress.loginName` 作為 job owner。Dashboard history 只列出目前登入者的工作；job detail、status、artifact、review 與 publish controller 都會驗證目前 OAuth user。缺少 owner 或 owner 不符時一律視為 job 不存在，避免跨維護者洩露 job ID 與 metadata。本機 BotPassword 模式視為單人環境，不套用此 filter。

`src/infra/job-retention.ts` 會刪除最後修改時間超過 30 天的直屬 job 目錄。Web server 啟動前會先清理一次，之後每 24 小時再執行；output root 不存在或個別目錄刪除失敗時，不會阻止應用程式啟動。

Maintenance publish history 存在 `generated/maintenance_publish_history.json`，由 `publish-service.ts` 透過 `recordMaintenancePublish` 寫入；新紀錄也包含 operator 與 OAuth consumer。`operational-events.ts` 會輸出可供 Toolforge logs 監控的登入失敗、refresh 失敗、publish failure、audit write failure 與 job duration 事件。

在 Toolforge，`config.ts` 會使用 `${TOOL_DATA_DIR}/photo-challenge-nodejs/output/jobs`，使 job artifact 與 audit 在 Pod 重啟後仍保留；`PHOTO_CHALLENGE_DATA_ROOT` 可明確覆寫資料根目錄。部署時必須掛載持久儲存並維持單一 replica；營運要求統一定義於第 11 節。

## 8. Action 與命名政策

新 job 的 vote-counting action 是 `count-votes-and-select-winners`。舊的 `process-challenge` 只保留給 persisted job 與 artifact compatibility，不應再出現在 UI 中。

共用 action、mode、source、entry validation 放在 `src/core/job-actions.ts`，供 Web 與 workflow 使用。

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
- `oauth-http.test.ts`：透過真實 Express HTTP route 驗證 OAuth callback、CSRF 拒絕與 session refresh。
- `maintenance-publish.test.ts`：maintenance plan guard 與 edit application。
- Parser、renderer、scoring tests：保護 Commons wikitext 相容性。

新增或調整 parser/renderer 時，應補 fixture 或 snapshot-like assertions，因為 Commons wikitext 輸出是最重要的相容性表面。

## 11. Toolforge 部署與營運

Toolforge deployment 屬於系統架構的一部分，因為 authentication session、持久 job data 與 publish auditability 都受 service topology 影響。版本庫內的 `toolforge/service.template` 是基準設定：

- 使用 `type: buildservice` 與 `mount: all`，由 Toolforge 建置程式並掛載持久 NFS 儲存。
- 使用 `replicas: 1`，因為 OAuth session 與 token 只存在單一 process。導入共享且加密的 session store 前不得增加 replica。
- 使用 `health-check-path: /healthz`，基準資源為 `500m` CPU、`512Mi` memory。
- Job data 預設放在 `${TOOL_DATA_DIR}/photo-challenge-nodejs/output/jobs`；只有需要明確替代的持久路徑時才設定 `PHOTO_CHALLENGE_DATA_ROOT`。
- 維護者授權資料保存在 `${TOOL_DATA_DIR}/photo-challenge-nodejs/output/config/maintainers.json`，並透過已驗證的 Web UI 編輯。

### Production baseline

正式服務為 `https://photo-challenge.toolforge.org/`，以單一 replica 的 `buildservice` 運行並固定使用 OAuth 模式。截至 2026-08-12，已部署且與 `main` 同步的 baseline 是 commit `ff608e0`，使用 Node.js `26.1.0`、npm `12.0.2` 與 Toolforge latest buildpack versions 建置。根目錄 `Procfile` 提供 `web: npm start` process；service status 顯示 running，restart 後仍必須以 `/healthz` smoke check 驗證，登入使用 Meta-Wiki OAuth flow。

### 部署設定與 secret

部署前執行 `npm ci`、`npm run check`、`npm run check:test`、`npm test` 與 `npm run build`。維基媒體 OAuth consumer 必須登記完全相符的 callback：`https://<tool-name>.toolforge.org/auth/callback`。

Production 設定應以互動提示建立，避免 secret 出現在 shell history 或 process argument：

```bash
toolforge envvars create WEB_AUTH_MODE
toolforge envvars create WIKIMEDIA_OAUTH_CLIENT_ID
toolforge envvars create WIKIMEDIA_OAUTH_CLIENT_SECRET
toolforge envvars create WIKIMEDIA_OAUTH_CALLBACK_URL
toolforge envvars create WEB_SESSION_SECRET
toolforge envvars create USER_AGENT
```

`WEB_SESSION_SECRET` 至少使用 32 個隨機 bytes 產生。Secret 不得 commit、不得寫入 `.env`、不得輸出到 logs，也不得放入 job artifacts。環境變數變更後必須重啟 Web service。

例行 production 部署應先將變更合併並驗證於 `main`，再從公開 branch 建置。Toolforge 可穩定解析公開 branch 與 tag 名稱；build ref 不應依賴縮寫 commit hash：

```bash
toolforge build start https://github.com/Sekidoki/photo-challenge-nodejs.git --ref main --use-latest-versions
toolforge build show
toolforge webservice buildservice start
toolforge webservice buildservice status
```

首次啟動前，將版本庫內的 service template 複製到 tool account。更新時先建置指定 commit、確認 build 成功，再執行 `toolforge webservice buildservice restart`。

### 部署驗證

最低限度的自動 smoke check 為：

```bash
curl --fail --show-error https://<tool-name>.toolforge.org/healthz
```

回應成功後才能繼續互動檢查。依序驗證 OAuth login/logout、dry-run workflow、sandbox review，以及一次 sandbox publish，並確認 revision 與 `publish-audit.jsonl` 紀錄一致；同時驗證 invalid CSRF token 會被拒絕。部署後第一次驗證不得使用 Commons live target。

### 監控與 audit

使用下列指令持續查看 application output：

```bash
toolforge webservice buildservice logs -f
```

Operational logs 使用 JSON event。建議初始告警門檻如下：

| Event | 初始處理門檻 |
| --- | --- |
| `oauth.login.failure` | 15 分鐘內出現 5 次時調查。 |
| `oauth.refresh.failure` | 重複發生時檢查 consumer 設定與 token validity。 |
| `publish.failure` | 立即調查；live mode 重試前先檢查 Commons history。 |
| `publish.audit.failure` | 暫停 live publish，直到 NFS 空間、mount 與權限恢復；必要時從 Commons revision 補回佐證。 |
| `job.duration` | Workflow latency 超過平常 p95 的兩倍或 30 分鐘時調查。 |

每次 publish attempt 都會 append audit record 到 `output/jobs/<job-id>/logs/publish-audit.jsonl`。紀錄必須包含 operator、OAuth consumer、mode、target title、revision ID、timestamp、workflow、result 與 event type，且不得包含 credential 或 token。Application logs 用於偵測事故；per-job audit file 是 publish accountability 的本機權威紀錄。

### 事故處理、rollback 與 rotation

- `/healthz` 失敗時，先檢查 service status 與 logs，再確認 `PORT`、Node.js start command 與目前 build。
- OAuth callback 失敗時，比對註冊的 callback URL 與 `WIKIMEDIA_OAUTH_CALLBACK_URL`，再確認 consumer 與環境變數，但不得暴露 secret value。
- Publish 失敗時，重試前先檢查 Commons page history，避免重複或衝突 edit。Audit write 失敗時，先停止 live publish，直到 persistent storage 修復。
- Rollback 時以已知正常的舊 commit 或 tag 重新 build 並 restart。NFS-backed job data 會保留，但 Pod restart 會使所有 in-memory session 失效，維護者必須重新登入。

Toolforge SSH 是 operator control path，不是 development environment。禁止以 VS Code Remote SSH 連入 Toolforge bastion，因為它可能留下多個 `sshd-session` processes 並耗盡帳號的 session allowance。每次只使用一個一般 OpenSSH session，不並行、不自動重試；多步操作應重用同一個 interactive session，完成後立即退出。自動化 operator 在建立 SSH 前，必須先提出完整指令、目的、讀寫影響與成功條件，取得明確核准後才能連線；連線卡住或 reset 後，未重新取得核准不得重試。

Secret rotation 的順序是：產生替代值、透過互動式 `toolforge envvars create` 更新、restart service、重跑 health/OAuth/sandbox smoke checks，確認替代值正常後才撤銷舊 credential。

Production 變更前，應以最新官方 [Toolforge Web Services](https://wikitech.wikimedia.org/wiki/Help:Toolforge/Web)、[Build Service](https://wikitech.wikimedia.org/wiki/Help:Toolforge/Build_Service) 與[環境變數](https://wikitech.wikimedia.org/wiki/Help:Toolforge/Envvars)文件核對實際操作。Authentication 與 UI 變更也必須遵循 [MediaWiki OAuth developer documentation](https://www.mediawiki.org/wiki/OAuth/For_Developers)、[OAuth application guidelines](https://meta.wikimedia.org/wiki/OAuth_app_guidelines) 與 [維基媒體 Codex](https://doc.wikimedia.org/codex/latest/) 指引。
