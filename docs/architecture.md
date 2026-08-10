# Photo Challenge Node.js Architecture

English | [臺灣正體中文](architecture.zh-TW.md)

This is the formal architecture document for Photo Challenge Node.js. It defines the current layers, data flow, responsibility boundaries, compatibility policy, and testing strategy for future maintenance.

## 1. System Purpose

Photo Challenge Node.js supports recurring Wikimedia Commons Photo Challenge operations through a Web UI:

- Generate voting pages from submission pages.
- Count and validate votes, then generate revised voting, result, and winners pages.
- Generate and publish post-results maintenance edits, including winner notifications, central announcements, Previous-page updates, and file assessment templates.

The primary architecture rule is to preserve Commons wikitext output behavior. Parser, renderer, and scoring output are high-compatibility surfaces, so changes there must be protected by fixtures or regression tests.

## 2. Layering

The main directory responsibilities are:

- `src/core/`: shared types, workflow action metadata, and request validation helpers used by Web and workflows. This layer must not depend on Web, Commons bot, or filesystem output concerns.
- `src/parsers/`: parses Commons wikitext, submission pages, voting pages, and challenge indexes. This layer should remain pure data transformation: no file writes and no Commons API calls.
- `src/renderers/`: renders voting, revised voting, result, winners, and voting index wikitext. Output format is protected by regression tests.
- `src/workflows/`: workflow orchestration, artifact persistence, publish target resolution, post-results maintenance plans, and publish services.
- `src/infra/`: configuration, credential store, job store, job history, output paths, and maintenance publish history.
- `src/services/`: external service adapters, currently focused on the Wikimedia Commons bot.
- `src/web/`: Express routes/controllers, Web view-model services, artifact service, Handlebars views, and static assets.
- `tests/`: focused unit tests and workflow fixture tests that protect refactors and output compatibility.

## 3. Entry Points and Data Flow

The sole entry point is the Web application in `src/web/app.ts` and `src/web/controllers/*`. It uses shared validation and action metadata from `src/core/job-actions.ts`. `JobRequest.action` is the workflow discriminator. When a workflow action is added or removed, update core metadata, Web form/view models, and tests together.

Typical data flow:

1. Web creates a `JobRequest`.
2. `runJob(jobId, request)` creates output paths, checks publish policy, and creates a Commons bot session.
3. `runJob` dispatches to the matching workflow handler.
4. The workflow reads source pages, calls parsers/renderers, and writes generated artifacts.
5. If the publish mode writes to Commons, the workflow or Web publish route saves pages through publish helpers/services.
6. Job metadata is written to `output/jobs/<job-id>/logs/job.log`, and Web can rebuild state from the job store or persisted job history.

## 4. Workflow Architecture

`src/workflows/run-job.ts` is the job dispatch and lifecycle shell. It is responsible for:

- Creating fixed output paths.
- Applying workflow publish policy.
- Creating the Commons bot session.
- Dispatching by `JobRequest.action`.
- Handling completion, failure, job logs, and job store state.

Specific workflow logic lives in independent handlers:

- `create-voting.ts`: generates voting pages and related artifacts from submission pages.
- `count-votes-and-select-winners.ts`: reads voting pages, validates/counts votes, and generates revised/result/winners artifacts.
- `archive-pages.ts`: archives challenge-related pages.
- `build-voting-index.ts`: generates voting index sections.
- `run-post-results-maintenance.ts`: creates post-results maintenance plans and related text/JSON artifacts.

Shared orchestration helpers live in `job-runner-support.ts`:

- Source page loading.
- Common artifact persistence.
- Challenge config persistence.
- Publish target resolution.
- Dry-run, sandbox, and live page publish helpers.
- Job finalization and failed job logs.

When adding a workflow, prefer a new independent handler. `run-job.ts` should only gain the dispatch branch and any required policy.

## 5. Publish Architecture

`src/workflows/publish-service.ts` centralizes Web publishing behavior:

- `readExistingPageContent`: reads current page content; missing pages return `null`.
- `publishStandardPages`: publishes voting, result, and winners pages.
- `publishMaintenanceEditPlans`: publishes maintenance edit plans, including live no-op skips, history records, and publish counts.

For standard publish, workflow helpers and Web review services decide how generated artifacts map to target titles. Actual save behavior should go through the publish service.

Maintenance publish is driven by maintenance plan JSON. `src/workflows/maintenance-publish.ts` is responsible for:

- `parseMaintenancePlanResult`: runtime schema guard with explicit success/failure results.
- `buildMaintenancePublishEntries`: internal workflow compatibility entry point; invalid plans throw clear errors.
- `buildMaintenancePublishEntriesFromPlan`: converts a validated plan into publish entries.
- `applyMaintenancePublishEntry`: applies one maintenance entry to current page content and returns the next wikitext.

Web publish uses `parseMaintenancePlanResult` to display warnings/notices, then calls `buildMaintenancePublishEntriesFromPlan`.

## 6. Web Architecture

`src/web/controllers/job-controller.ts` should remain an HTTP controller. It is responsible for:

- Parsing request bodies, query strings, and route params.
- Applying route guards.
- Resolving credentials.
- Redirecting and rendering.
- Calling workflow, artifact, review, and publish services.

The controller should not own artifact classification, diff review, maintenance plan schema validation, or publish edit-plan assembly.

Web domain/service files:

- `i18n.ts`: owns supported UI locales, the English/Traditional Chinese message catalog, request locale resolution, interpolation, and language-switch URLs. Templates use the `t` helper; review services receive a translator when their view-model text is user-facing.
- `artifacts.ts`: lists generated/log artifacts, classifies core artifacts, and resolves artifact preview/download paths.
- `publish-review.ts`: selects standard publish artifacts and summarizes diffs.
- `standard-publish-review.ts`: builds standard publish review view models and publish plans.
- `maintenance-review.ts`: summarizes maintenance artifacts.
- `maintenance-publish-review.ts`: builds maintenance publish review view models, including invalid-plan warnings and live diff review.

Handlebars views only render view models. They should not read files, call Commons, or parse maintenance plans.

The Web UI consumes pinned Wikimedia Codex design-token CSS from the installed package through a local static route; Toolforge pages do not depend on a third-party CDN. `styles.css` should use Codex variables for colors, borders, shadows, typography, and focus state. The dashboard's small JavaScript enhancement only reveals and enables settings for the selected workflow; the complete form remains usable as server-rendered HTML when JavaScript is unavailable.

### Web authentication

The deployed Web UI uses Wikimedia OAuth 2 Authorization Code flow with PKCE. `src/web/oauth-session.ts` owns authorization state, token exchange/refresh, signed cookies, maintainer authorization, and CSRF tokens. Access and refresh tokens stay in the server process and must never be written to job logs or artifacts. A Web job copies only the current short-lived access token into its in-memory `JobRequest`.

Maintainer authorization is fail-closed and persisted at `output/config/maintainers.json`. `Sekidoki` is the protected owner and cannot be changed through the Web UI. The owner can grant or revoke list-manager and regular-maintainer roles. List managers can add or remove regular maintainers but cannot alter the owner or another list manager. Role membership is rechecked on every authenticated request, so removal invalidates an existing session on its next request. Emergency owner replacement requires an explicit code and deployment change.

`WEB_AUTH_MODE` explicitly separates authentication modes:

- `oauth` is required for Toolforge and other production deployments. Web always uses the signed-in maintainer's Wikimedia identity, and the service refuses to start if required OAuth settings are incomplete.
- `local` is only for a developer workstation using the existing BotPassword form, and the server binds only to `127.0.0.1`; an explicit local setting on Toolforge or in production is rejected at startup.
- When `NODE_ENV=production` or `TOOL_DATA_DIR` is present, an omitted mode safely defaults to `oauth` and never falls back to BotPassword.

The in-memory OAuth session store assumes one Toolforge Web replica. Moving to multiple replicas requires a shared encrypted session store before increasing the replica count.

OAuth callback, CSRF rejection, and access-token refresh are covered at the HTTP boundary by `oauth-http.test.ts`. OAuth login and refresh failures emit typed operational events without raw errors, tokens, complete user agents, or IP addresses.

## 7. Artifacts, Job History, and Publish History

Each job uses a fixed output directory:

```text
output/jobs/<job-id>/
  input/
  generated/
  logs/job.log
  logs/publish-audit.jsonl
```

- `input/`: source pages read from Commons.
- `generated/`: generated wikitext, JSON plans, summaries, and publish history.
- `logs/job.log`: minimal metadata used to rebuild job history.
- `logs/publish-audit.jsonl`: append-only structured records for publish success, failure, and no-op skips. Records include operator, OAuth consumer, mode, target, revision ID, timestamp, workflow, and result, but never credentials or OAuth tokens.

`src/infra/job-history.ts` rebuilds past jobs from `logs/job.log`. Changes to log fields must consider compatibility with old jobs.

`src/infra/job-retention.ts` removes direct child job directories whose last-modified time is more than 30 days old. Cleanup runs before the Web server starts and repeats every 24 hours. Missing output roots and individual removal failures do not prevent the application from starting.

Maintenance publish history is stored in `generated/maintenance_publish_history.json` and is written by `publish-service.ts` through `recordMaintenancePublish`. New records also include the operator and OAuth consumer. `operational-events.ts` emits structured login failures, refresh failures, publish failures, audit-write failures, and job duration events for Toolforge log monitoring.

On Toolforge, `config.ts` uses `${TOOL_DATA_DIR}/photo-challenge-nodejs/output/jobs` so job artifacts and audit records survive Pod restarts. `PHOTO_CHALLENGE_DATA_ROOT` can explicitly override the data root. Deployment must mount persistent Toolforge storage and remain at one replica; operational requirements are defined in section 11.

## 8. Action and Naming Policy

The current vote-counting action for new jobs is `count-votes-and-select-winners`. The legacy `process-challenge` action is retained only for persisted job and artifact compatibility; it should not appear in the UI.

Shared validation for actions, modes, sources, and entry modes lives in `src/core/job-actions.ts` for Web and workflow use.

Public types and cross-module functions should avoid overly generic names. New APIs should prefer domain-specific names such as `PublishReviewEntry`, `MaintenancePublishEntry`, `ArtifactEntry`, and `SourcePageSpec`.

## 9. Sandbox Path Compatibility

The maintenance announcement sandbox target still uses the existing historical path:

```text
User:<name>/Sandbox/Photo Challenge talk page Annoucement
```

`Annoucement` is a historical spelling. Do not directly rename it to `Announcement`, because existing sandbox pages and publish history may depend on the old path. If this is corrected later, support old/new aliases or provide a migration note.

## 10. Testing Strategy

Run these checks first when refactoring or adding behavior:

```bash
npm run check
npm run check:test
npm test
```

Primary test boundaries:

- `job-actions.test.ts`: shared request validation and action metadata.
- `workflow-integration.test.ts`: offline generated artifacts remain stable.
- `publish-review.test.ts` and `maintenance-review.test.ts`: Web review service view models.
- `publish-service.test.ts`: publish save, skip, and history behavior.
- `oauth-http.test.ts`: OAuth callback, CSRF rejection, and session refresh through real Express HTTP routes.
- `maintenance-publish.test.ts`: maintenance plan guards and edit application.
- Parser, renderer, and scoring tests: Commons wikitext compatibility.

When changing parsers or renderers, add fixtures or snapshot-like assertions. Commons wikitext output is the most important compatibility surface.

## 11. Toolforge Deployment and Operations

Toolforge deployment is part of the system architecture because authentication sessions, persistent job data, and publish auditability depend on the service topology. The checked-in `toolforge/service.template` is the baseline configuration:

- `type: buildservice` with `mount: all`, so the application is built by Toolforge and can use persistent NFS storage.
- `replicas: 1`, because OAuth sessions and tokens are process-local. Do not increase the replica count until a shared encrypted session store is implemented.
- `health-check-path: /healthz`, with a baseline allocation of `500m` CPU and `512Mi` memory.
- Job data defaults to `${TOOL_DATA_DIR}/photo-challenge-nodejs/output/jobs`. Use `PHOTO_CHALLENGE_DATA_ROOT` only when an explicit alternative persistent root is required.
- Maintainer authorization data is stored at `${TOOL_DATA_DIR}/photo-challenge-nodejs/output/config/maintainers.json` and is edited through the authenticated Web UI.

### Deployment configuration and secrets

Before deployment, run `npm ci`, `npm run check`, `npm run check:test`, `npm test`, and `npm run build`. Register the exact OAuth callback `https://<tool-name>.toolforge.org/auth/callback` with the Wikimedia OAuth consumer.

Create production settings interactively so secret values do not appear in shell history or process arguments:

```bash
toolforge envvars create WEB_AUTH_MODE
toolforge envvars create WIKIMEDIA_OAUTH_CLIENT_ID
toolforge envvars create WIKIMEDIA_OAUTH_CLIENT_SECRET
toolforge envvars create WIKIMEDIA_OAUTH_CALLBACK_URL
toolforge envvars create WEB_SESSION_SECRET
toolforge envvars create USER_AGENT
```

`WEB_SESSION_SECRET` must be generated from at least 32 random bytes. Secrets must not be committed, stored in `.env`, printed to logs, or copied into job artifacts. Restart the Web service after changing environment variables.

Build and start from an immutable commit or tag:

```bash
toolforge build start <repository-url> --ref <commit-or-tag>
toolforge build show
toolforge webservice buildservice start
toolforge webservice buildservice status
```

Copy the checked-in service template to the tool account before the first start. For an update, build the selected commit, confirm the build succeeds, and then run `toolforge webservice buildservice restart`.

### Deployment verification

The minimum automated smoke check is:

```bash
curl --fail --show-error https://<tool-name>.toolforge.org/healthz
```

The response must be successful before interactive checks continue. Verify OAuth login and logout, a dry-run workflow, a sandbox review, and one sandbox publish whose revision and `publish-audit.jsonl` record agree. Also verify that a request with an invalid CSRF token is rejected. Never use a live Commons target for initial post-deployment verification.

### Monitoring and audit

Stream application output with:

```bash
toolforge webservice buildservice logs -f
```

Operational logs are JSON events. Suggested initial alert thresholds are:

| Event | Initial response threshold |
| --- | --- |
| `oauth.login.failure` | Investigate after 5 events in 15 minutes. |
| `oauth.refresh.failure` | Check consumer configuration and token validity when repeated. |
| `publish.failure` | Investigate immediately; inspect Commons history before retrying live mode. |
| `publish.audit.failure` | Stop live publishing until NFS space, mount, and permissions are healthy; backfill evidence from the Commons revision if necessary. |
| `job.duration` | Investigate workflow latency above twice its normal p95 or 30 minutes. |

Every publish attempt writes an append-only audit record to `output/jobs/<job-id>/logs/publish-audit.jsonl`. The record must identify the operator, OAuth consumer, mode, target title, revision ID, timestamp, workflow, result, and event type without including a credential or token. Application logs help detect incidents; the per-job audit file is the authoritative local record for publish accountability.

### Incident response, rollback, and rotation

- If `/healthz` fails, check service status and logs first, then confirm `PORT`, the Node.js start command, and the current build.
- If OAuth callback fails, compare the registered callback URL with `WIKIMEDIA_OAUTH_CALLBACK_URL`, then verify the consumer and environment variables without exposing their values.
- If publishing fails, inspect the Commons page history before retrying to avoid duplicate or conflicting edits. If audit writing fails, pause live publishing until persistent storage is repaired.
- Roll back by building a previously known-good commit or tag and restarting the service. NFS-backed job data remains available, but a Pod restart invalidates all in-memory sessions and requires maintainers to sign in again.

Rotate a secret by generating a replacement, updating it through the interactive `toolforge envvars create` prompt, restarting the service, and repeating the health/OAuth/sandbox smoke checks. Revoke the old credential only after the replacement is verified.

Operational behavior should be checked against the current official [Toolforge Web Services](https://wikitech.wikimedia.org/wiki/Help:Toolforge/Web), [Build Service](https://wikitech.wikimedia.org/wiki/Help:Toolforge/Build_Service), and [environment variables](https://wikitech.wikimedia.org/wiki/Help:Toolforge/Envvars) documentation before production changes.
