# Photo Challenge Node.js Architecture

English | [臺灣正體中文](architecture.zh-TW.md)

This is the formal architecture document for Photo Challenge Node.js. It defines the current layers, data flow, responsibility boundaries, compatibility policy, and testing strategy for future maintenance.

## 1. System Purpose

Photo Challenge Node.js supports recurring Wikimedia Commons Photo Challenge operations. It provides both a Web UI and a CLI for these jobs:

- Generate voting pages from submission pages.
- Count and validate votes, then generate revised voting, result, and winners pages.
- Generate and publish post-results maintenance edits, including winner notifications, central announcements, Previous-page updates, and file assessment templates.

The primary architecture rule is to preserve Commons wikitext output behavior. Parser, renderer, and scoring output are high-compatibility surfaces, so changes there must be protected by fixtures or regression tests.

## 2. Layering

The main directory responsibilities are:

- `src/core/`: shared types, workflow action metadata, and request validation helpers used by Web, CLI, and workflows. This layer must not depend on Web, Commons bot, or filesystem output concerns.
- `src/parsers/`: parses Commons wikitext, submission pages, voting pages, and challenge indexes. This layer should remain pure data transformation: no file writes and no Commons API calls.
- `src/renderers/`: renders voting, revised voting, result, winners, and voting index wikitext. Output format is protected by regression tests.
- `src/workflows/`: workflow orchestration, artifact persistence, publish target resolution, post-results maintenance plans, and publish services.
- `src/infra/`: configuration, credential store, job store, job history, output paths, and maintenance publish history.
- `src/services/`: external service adapters, currently focused on the Wikimedia Commons bot.
- `src/web/`: Express routes/controllers, Web view-model services, artifact service, Handlebars views, and static assets.
- `tests/`: focused unit tests and workflow fixture tests that protect refactors and output compatibility.

## 3. Entry Points and Data Flow

The system has two main entry points:

- CLI: `src/cli/index.ts`
- Web: `src/web/app.ts` and `src/web/controllers/*`

Both entry points should use shared validation and action metadata from `src/core/job-actions.ts`. `JobRequest.action` is the workflow discriminator. When a workflow action is added or removed, update core metadata, CLI parsing, Web form/view models, and tests together.

Typical data flow:

1. CLI or Web creates a `JobRequest`.
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

`src/workflows/publish-service.ts` centralizes shared behavior between Web manual publishing and CLI automatic publishing:

- `readExistingPageContent`: reads current page content; missing pages return `null`.
- `publishStandardPages`: publishes voting, result, and winners pages.
- `publishMaintenanceEditPlans`: publishes maintenance edit plans, including live no-op skips, history records, and publish counts.

For standard publish, workflow helpers and Web review services decide how generated artifacts map to target titles. Actual save behavior should go through the publish service so Web routes and CLI workflows do not diverge.

Maintenance publish is driven by maintenance plan JSON. `src/workflows/maintenance-publish.ts` is responsible for:

- `parseMaintenancePlanResult`: runtime schema guard with explicit success/failure results.
- `buildMaintenancePublishEntries`: compatibility entry point; invalid plans throw clear errors, so CLI automatic publish fails fast.
- `buildMaintenancePublishEntriesFromPlan`: converts a validated plan into publish entries.
- `applyMaintenancePublishEntry`: applies one maintenance entry to current page content and returns the next wikitext.

Web manual publish uses `parseMaintenancePlanResult` to display warnings/notices, then calls `buildMaintenancePublishEntriesFromPlan`. CLI automatic publish calls `buildMaintenancePublishEntries` directly.

## 6. Web Architecture

`src/web/controllers/job-controller.ts` should remain an HTTP controller. It is responsible for:

- Parsing request bodies, query strings, and route params.
- Applying route guards.
- Resolving credentials.
- Redirecting and rendering.
- Calling workflow, artifact, review, and publish services.

The controller should not own artifact classification, diff review, maintenance plan schema validation, or publish edit-plan assembly.

Web domain/service files:

- `artifacts.ts`: lists generated/log artifacts, classifies core artifacts, and resolves artifact preview/download paths.
- `publish-review.ts`: selects standard publish artifacts and summarizes diffs.
- `standard-publish-review.ts`: builds standard publish review view models and publish plans.
- `maintenance-review.ts`: summarizes maintenance artifacts.
- `maintenance-publish-review.ts`: builds maintenance publish review view models, including invalid-plan warnings and live diff review.

Handlebars views only render view models. They should not read files, call Commons, or parse maintenance plans.

### Web authentication

The deployed Web UI uses Wikimedia OAuth 2 Authorization Code flow with PKCE. `src/web/oauth-session.ts` owns authorization state, token exchange/refresh, signed cookies, optional maintainer allowlisting, and CSRF tokens. Access and refresh tokens stay in the server process and must never be written to job logs or artifacts. A Web job copies only the current short-lived access token into its in-memory `JobRequest`.

OAuth and BotPassword deliberately coexist at different entry points:

- Web uses the signed-in maintainer's Wikimedia identity whenever OAuth is configured.
- CLI continues to use `NAME` and `BOT_PASSWORD`.
- Local Web development can fall back to the existing BotPassword form when OAuth is not configured.

The in-memory OAuth session store assumes one Toolforge Web replica. Moving to multiple replicas requires a shared encrypted session store before increasing the replica count.

## 7. Artifacts, Job History, and Publish History

Each job uses a fixed output directory:

```text
output/jobs/<job-id>/
  input/
  generated/
  logs/job.log
```

- `input/`: source pages read from Commons.
- `generated/`: generated wikitext, JSON plans, summaries, and publish history.
- `logs/job.log`: minimal metadata used to rebuild job history.

`src/infra/job-history.ts` rebuilds past jobs from `logs/job.log`. Changes to log fields must consider compatibility with old jobs.

Maintenance publish history is stored in `generated/maintenance_publish_history.json` and is written by `publish-service.ts` through `recordMaintenancePublish`.

## 8. Action and Naming Policy

The current vote-counting action for new jobs is `count-votes-and-select-winners`. The legacy `process-challenge` action is retained only for persisted job and artifact compatibility; it should not appear in new UI or CLI commands.

Shared validation for actions, modes, sources, and entry modes lives in `src/core/job-actions.ts`. Web and CLI should both use this layer to avoid different fallback behavior across entry points.

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
- `maintenance-publish.test.ts`: maintenance plan guards and edit application.
- Parser, renderer, and scoring tests: Commons wikitext compatibility.

When changing parsers or renderers, add fixtures or snapshot-like assertions. Commons wikitext output is the most important compatibility surface.
