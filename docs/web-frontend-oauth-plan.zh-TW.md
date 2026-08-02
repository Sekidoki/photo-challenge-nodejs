# Toolforge 前端與 Wikimedia OAuth 方案

本文件記錄 2026 年 8 月的網路比較、採用決策、目前已完成的 OAuth 基礎，以及後續前端演進順序。

## 1. 同類工具比較

| 專案 | 與本專案相近處 | 前端／登入做法 | 可採用的經驗 |
| --- | --- | --- | --- |
| [QuickStatements 3](https://github.com/WikiMovimentoBrasil/quickstatements3) | 批次產生並發布 Wikimedia 編輯、需要工作狀態與管理介面 | Django + server-rendered HTML/HTMX；OAuth 2；Toolforge 部署 | 維持伺服器端流程頁即可，不需要為了互動性先改成 SPA；OAuth 2 token 應隨使用者 session 隔離 |
| [CropTool](https://github.com/danmichaelo/croptool) | 對 Commons 執行具風險的寫入操作；需要預覽與明確確認 | PHP/JavaScript 前端；OAuth 1；依單一任務引導使用者 | 把複雜參數包成任務步驟；寫入前清楚顯示目標、變更與結果 |
| [WikiScriptSync](https://meta.wikimedia.org/wiki/WikiScriptSync) | 多位維護者、產生內容後預覽再發布、需要稽核紀錄 | Django；OAuth 僅識別身分，特殊高風險發布另用 BotPassword；保留永久 audit log | 登入、預覽、確認、發布、稽核應分層；權限必須依實際風險最小化 |
| [Wikimedia Codex](https://doc.wikimedia.org/codex/latest/) | Wikimedia 生態系 Web UI | 官方 design tokens、元件與 accessibility/i18n 規範 | 視覺與互動應逐步靠攏 Codex，而不是建立另一套自訂 design system |

Toolforge 的 Web 文件建議使用獨立 `/healthz`、避免載入 Wikimedia 控制範圍外的第三方資源，並由 Toolforge proxy 處理 TLS；預設資源為 0.5 CPU、512 MiB。[Toolforge Web 文件](https://wikitech.wikimedia.org/wiki/Help:Toolforge/Web)

## 2. 採用方案

保留 Express + Handlebars 的 server-rendered 架構。現有頁面以表單、工作進度、artifact、diff review 為主，SSR 已能完整支援；此時改為 React/Vue SPA 會增加 build、client state、API 與錯誤處理的雙重維護成本，卻不會直接改善 Commons workflow 的正確性。

前端資訊架構分成四層：

1. 全站列：工具名稱、目前 Wikimedia 帳號、登入／登出。
2. Dashboard：最近工作、建立新工作、目前登入與環境狀態。
3. Job workspace：進度、訊息、輸入與產物。
4. Review/publish：目標頁、diff、sandbox/live 模式、明確確認、發布結果與 audit history。

視覺演進使用 Codex design tokens。第一階段不導入完整 Vue component runtime，只替換色彩、間距、focus、表單及按鈕狀態；有真正需要 client-side 複雜互動時，再局部加入 Codex component，而不是整站重寫。

## 3. OAuth 架構

已採用 Wikimedia OAuth 2 Authorization Code flow，並加入 PKCE：

```text
Browser -> GET /auth/login
        -> Meta-Wiki authorize + consent
        -> GET /auth/callback?code=...&state=...
        -> server exchanges code and reads profile
        -> signed HttpOnly SameSite=Lax session cookie
        -> mwn sends Bearer token to Commons Action API
```

安全邊界：

- Access token 與 refresh token 只存伺服器記憶體，不進 cookie、不進 job log、不進 artifact。
- Cookie 只含經 HMAC 簽章的 opaque session ID；HTTPS callback 時加上 `Secure`。
- Login 使用一次性 state、10 分鐘期限與 PKCE S256。
- 所有 OAuth 模式的 POST job/publish/logout 需通過 session CSRF token。
- `WIKIMEDIA_OAUTH_ALLOWED_USERS` 可選擇限制維護者；留空表示任何同意授權的 Wikimedia 使用者都能操作。
- 工作與發布使用當下登入者自己的 Wikimedia 權限，維護者不需共用專案擁有者的密碼。

MediaWiki 官方 OAuth 文件說明 Authorization Code、refresh token、profile endpoint 與 Bearer token API 用法；OAuth app guidelines 要求 HTTPS、最小權限、清楚說明資料處理，且公開 app 需經 OAuth admin 審查。[開發者文件](https://www.mediawiki.org/wiki/OAuth/For_Developers) · [App guidelines](https://meta.wikimedia.org/wiki/OAuth_app_guidelines)

## 4. OAuth 註冊與部署

在 Meta-Wiki 的 `Special:OAuthConsumerRegistration/propose` 建立 confidential OAuth 2 application：

- Applicable project：只選 Wikimedia Commons。
- Callback：精確使用 `https://<tool-name>.toolforge.org/auth/callback`。
- Grant type：`authorization_code`、`refresh_token`。
- Grants：先申請 `Edit existing pages` 與 `Create, edit, and move pages`；只有確認目標頁保護等級真的需要時才另加權限。
- 公開描述應說明用途、source repository、資料保存方式、sandbox/live review 流程。

Toolforge secret 環境設定：

```dotenv
WIKIMEDIA_OAUTH_CLIENT_ID=...
WIKIMEDIA_OAUTH_CLIENT_SECRET=...
WIKIMEDIA_OAUTH_CALLBACK_URL=https://<tool-name>.toolforge.org/auth/callback
WEB_SESSION_SECRET=<至少 32 bytes 的隨機值>
WIKIMEDIA_OAUTH_ALLOWED_USERS=MaintainerOne,MaintainerTwo
```

目前 session 為單一 process 記憶體保存，因此部署先維持一個 replica。Pod 重啟後使用者需重新登入，但 refresh/access token 不會殘留在 NFS。若未來需要多 replica 或無感重啟，再導入 Toolforge 可用的共享資料庫，並以獨立 encryption key 加密 refresh token。

## 5. 分期路線

### 已完成：登入基礎

- OAuth 2 login/callback/logout。
- Token refresh、簽章 cookie、PKCE、CSRF、可選 allowlist。
- Web workflow 與 publish 改用登入者 OAuth token。
- CLI 與未設定 OAuth 的本機 Web 保留 BotPassword 相容性。

### 已完成：前端一致性

- 已固定使用 `@wikimedia/codex-design-tokens` 2.6.2；應用程式 CSS 的色彩、邊框、陰影與 focus 樣式改用官方 CSS variables，並依系統偏好載入 dark mode tokens。
- Dashboard 的三個 workflow 與 publish mode 改為精簡 task-card grid；選定 workflow 後才顯示並啟用相關設定，未執行 JavaScript 時仍可看到所有欄位。
- 標準 publish review 與 maintenance review 都以 sticky 安全摘要持續顯示帳號、Wikimedia Commons、模式及目標數量；live 模式使用破壞性警告與按鈕樣式，sandbox 則提示先行驗證。
- `src/web/i18n.ts` 集中英文／繁中 UI message、請求語系判斷、插值與語言切換 URL；選擇會保存在 `ui_lang` cookie，頁面切換時保留原路徑與 query。
- Web review service 接受 translator，讓 diff 狀態、警告與維護摘要不再散落成固定英文；缺少翻譯時回退英文。
- 新增 message catalog 的語系優先序、插值、fallback 與 URL 保留測試。

### 已完成：營運可靠性

- 新增 Web OAuth callback、CSRF 拒絕、session refresh 的 Express HTTP integration tests。
- 所有 Web／CLI publish 路徑寫入 `logs/publish-audit.jsonl`；欄位包含操作者、OAuth consumer、模式、目標、revision ID、時間、workflow 與結果，且不記錄 token。
- Maintenance publish history 同步保存 operator 與 OAuth consumer，舊紀錄仍可讀取。
- `/healthz` 搭配 Toolforge HTTP health check；typed operational events 可監控登入失敗、refresh failure、publish failure、audit write failure 與 job duration，不記錄秘密、完整 user agent 或 IP。
- 已將 Toolforge deployment、smoke test、監控、rollback 與 secret rotation 納入 `architecture.md` 的部署與營運架構，並在 Toolforge 自動使用 `TOOL_DATA_DIR` 保存 output 與 audit。
- OAuth session 仍為 process memory，部署維持單一 replica；確認需要多 replica 後，才導入共享且加密的 session storage

## 6. 驗收標準

- 新維護者不需取得原維護者的 BotPassword 即可登入、dry-run、sandbox、review、publish。
- Commons edit history 顯示實際授權使用者，並帶 OAuth consumer tag。
- 登出、token 過期、Pod 重啟後都不會留下可用 cookie session。
- 未登入或 CSRF 錯誤不能建立或發布工作。
- 所有 live publish 仍必須經既有 review 頁面，且 CLI regression fixtures 完全不變。
