# Photo Challenge Node.js

[English](README.md) | 繁體中文

這是一個用於 Wikimedia Commons Photo Challenge 作業流程的 Node.js + TypeScript 專案。
它同時提供 Web UI 與 CLI，處理三種常見工作：
- 從 submission pages 產生 voting page
- 驗票並產生 revised/result/winners 頁面
- 規劃與發佈 post-results maintenance 項目

## 環境需求

- Node.js `26.7.0`
- npm `12`
- CLI 使用 Wikimedia Commons BotPassword；共享 Web 部署則使用 Wikimedia OAuth 2 client

基本設定：
- 將 `.env.example` 複製為 `.env`
- `NAME` 填入完整 BotPassword 登入名稱，例如 `MainAccount@BotAppName`
- 設定 `BOT_PASSWORD`
- 視需要設定 `USER_AGENT`、`PORT`、`CREDENTIAL_SERVICE_NAME`

共享 Web 部署時，請在 Meta-Wiki 註冊 confidential OAuth 2 application，callback URL 必須精確設定為 `<公開網址>/auth/callback`，並填入 `WIKIMEDIA_OAUTH_CLIENT_ID`、`WIKIMEDIA_OAUTH_CLIENT_SECRET`、`WIKIMEDIA_OAUTH_CALLBACK_URL` 與隨機的 `WEB_SESSION_SECRET`。建議只申請「Edit existing pages」及「Create, edit, and move pages」，並限定 Wikimedia Commons。維護者權限採 fail-closed，登入後從 `/maintainers` 管理；`Sekidoki` 是受保護的擁有者。

## 安裝

```bash
npm install
```

## 快速開始

Web 開發模式：

```bash
npm run dev
```

正式建置與啟動：

```bash
npm run build
npm start
```

CLI 範例：

```bash
npm run cli -- create-voting --challenge "2026 - March - Three-wheelers"
npm run cli -- count-votes-and-select-winners --challenge "2026 - February - Orange"
node dist/cli.js post-results-maintenance --challenge "2026 - February - Orange" --paired-challenge "2026 - February - First aid" --publish-mode dry-run
node dist/cli.js post-results-maintenance --challenge "2026 - February - Orange" --publish-mode live
```

## 使用概覽

### 1. Prepare voting page

適用於投票開始前。
產物會寫到 `output/jobs/<job-id>/generated/`，包含 `*_voting.txt`、`*_files.json`、`*_challenge-config.json`、`*_summary.txt`。

預設為單圖、單月挑戰。雙圖像挑戰可使用 `--entry-mode duo-coequal` 或 `--entry-mode duo-reference`。只有社群確認採用例外時長時，才覆寫 `--submission-start` 與 `--submission-end`；雙圖像模式本身不會自動延長投稿期間。

### 2. Count votes and select winners

適用於投票結束後。
此流程會驗證投票者與投票內容、檢查截止時間，並產生 `*_revised.txt`、`*_result.txt`、`*_winners.txt`。
Late vote 的判定使用每月月初 00:00 AoE 的 Photo Challenge 截止時間，生成結果也會反映相同的 cutoff。

### 3. Post-results maintenance

適用於 winners 已經確定後。
此流程會準備得獎通知、challenge announcement、Previous-page update 與 file assessment plans。現在 `sandbox` 與 `live` 已正式支援這四類後續維護發佈，而 Web UI 仍保留 grouped review 方便你在發佈前後檢查。

## 發佈與安全說明

- `create-voting` 與 `count-votes-and-select-winners` 支援 `dry-run`、`sandbox`、`live`
- `post-results-maintenance` 已支援 `dry-run`、`sandbox`、`live`，可正式發佈得獎通知、central announcement、Previous-page update 與檔案頁模板
- `sandbox` 目標頁會依 `NAME` 中 `@` 前的主帳號名稱自動推導
- 已保存的登入資訊優先走系統 keychain，若不可用則退回本次程式執行期間的記憶體保存
- 啟用 OAuth 後，Web job 與 publish 使用目前登入維護者的短期 OAuth token；CLI 仍維持 BotPassword
- job history 會從 `output/jobs/*/logs/job.log` 重建
- Web 啟動時及之後每 24 小時會檢查 job 目錄，CLI 啟動時也會檢查；最後修改時間超過 30 天的 `output/jobs/<job-id>/` 會自動刪除

## 驗證與排錯

常用命令：

```bash
npm run check
npm run check:test
npm test
```

相容性狀態：目前已在 Node.js `26.7.0` 與 npm `12.0.2` 驗證通過。

補充：
- `.env` 不應進版控
- job 與 publish history 最多保留 30 天；若需要長期保存，請另外備份 `output/jobs/`
- 測試新流程時，先走 `sandbox` 再走 `live`

## 專案現況

目前已完成並可使用：
- Web UI：job 建立、進度追蹤、artifact preview、publish review、maintenance review
- CLI：主要 workflow 與 list/archive/voting-index helper commands
- Commons 寫入：voting/result/winners 頁面發佈
- 後續維護：得獎通知、central announcement、Previous-page update 與檔案頁模板都可正式發佈，且 publish history 會持久化保存
- parser、renderer、CLI、job history、offline workflow fixtures 的 regression tests

維護者文件：
- 正式架構與責任邊界：[docs/architecture.zh-TW.md](docs/architecture.zh-TW.md)
- Toolforge 比較、前端方案與 OAuth 上線步驟：[docs/web-frontend-oauth-plan.zh-TW.md](docs/web-frontend-oauth-plan.zh-TW.md)

建議下一步：
- 增加 Toolforge replica 前，先導入共享且加密的 session store
- 擴充更舊 Commons 頁面格式與特殊簽名 fixtures
- 補 create-voting、count-votes-and-select-winners、maintenance publish 的 Web flow integration tests
- 視需要加入 changed line 內更細的字詞級 diff

## 相關資源

- 範例環境設定檔：[.env.example](.env.example)
- 改寫來源：[Commons Photo Challenge](https://github.com/jarek-tuszynski/Commons_photo_challenge)，Jarek Tuszynski，公有領域授權
- 英文 README：[README.md](README.md)
