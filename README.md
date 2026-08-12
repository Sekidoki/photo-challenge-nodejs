# Photo Challenge Node.js

English | [繁體中文](README.zh-TW.md)

A Node.js + TypeScript application for Wikimedia Commons Photo Challenge operations.
It provides a Web UI for three common workflows:

- prepare voting pages from submission pages
- process votes and generate revised/result/winners pages
- plan and publish post-results maintenance tasks

## Requirements

- Node.js `26.x`
- npm `12`
- A Wikimedia Commons BotPassword for local Web development (bound to `127.0.0.1` only), or a Wikimedia OAuth 2 client for a deployed Web UI

Setup details:
- copy `.env.example` to `.env`
- set `WEB_AUTH_MODE=local`
- set `NAME` to your full BotPassword login such as `MainAccount@BotAppName`
- set `BOT_PASSWORD`
- optional: set `USER_AGENT`, `PORT`, and `CREDENTIAL_SERVICE_NAME`

For a shared Web deployment, set `WEB_AUTH_MODE=oauth` and register a confidential OAuth 2 application on Meta-Wiki with the exact callback URL `<public-base-url>/auth/callback`. Then set `WIKIMEDIA_OAUTH_CLIENT_ID`, `WIKIMEDIA_OAUTH_CLIENT_SECRET`, `WIKIMEDIA_OAUTH_CALLBACK_URL`, and a random `WEB_SESSION_SECRET`. OAuth mode refuses to start when any required setting is missing and never falls back to BotPassword. The recommended grants are “Edit existing pages” and “Create, edit, and move pages”, limited to Wikimedia Commons. Maintainer access is fail-closed and managed from `/maintainers`; the protected owner is bootstrapped from `config/maintainers.bootstrap.json` and persisted in the same registry list as all other maintainers.

## Install

```bash
npm install
```

## Quick Start

Web app:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

Toolforge Build Service uses the root `Procfile` to run the same `npm start` entry point.

## Production Deployment

The production application is deployed at [photo-challenge.toolforge.org](https://photo-challenge.toolforge.org/) as a single-replica Toolforge `buildservice` with persistent storage mounted. It runs in OAuth mode; the public UI never exposes or falls back to BotPassword authentication.

The current production baseline was built from commit `ff608e0`, which is now merged into `main`. The verified Toolforge runtime is Node.js `26.1.0` with npm `12.0.2`; `/healthz` is the deployment smoke-check endpoint. See the architecture document for the complete build, restart, verification, rollback, and SSH operating procedure.

## Usage Overview

### 1. Prepare voting page

Use this before voting starts.
Outputs are written under `output/jobs/<job-id>/generated/`, including `*_voting.txt`, `*_files.json`, `*_challenge-config.json`, and `*_summary.txt`.

The default is a single-image, single-month challenge. For paired-image challenges, use `--entry-mode duo-coequal` or `--entry-mode duo-reference`. Only override `--submission-start` and `--submission-end` when the community has approved an exceptional duration; paired-image mode does not automatically extend the submission window.

Winner pages for all three entry modes use the updated `{{Photo challenge winners table}}` on Commons; the existing single-image parameters remain backward compatible.

### 2. Count votes and select winners

Use this after voting ends.
This workflow validates voters and votes, checks deadlines, and generates `*_revised.txt`, `*_result.txt`, and `*_winners.txt`.
Late-vote checks use the Photo Challenge closing time of 00:00 AoE at the start of the next month, and generated outputs reflect that same cutoff.

### 3. Post-results maintenance

Use this after winners are known.
It creates winner notifications, challenge announcements, Previous-page updates, and file assessment plans. `sandbox` and `live` now formally publish all four maintenance edit types, and the Web UI still provides grouped review before or after publishing.

## Publish and Safety Notes

- `create-voting` and `count-votes-and-select-winners` support `dry-run`, `sandbox`, and `live`
- `post-results-maintenance` supports `dry-run`, `sandbox`, and `live` for winner notifications, central announcements, Previous-page updates, and file assessment templates
- sandbox targets are derived from the main account part before `@` in `NAME`
- saved credentials use the system keychain when available, with in-memory fallback for the current process
- OAuth-mode jobs and publishes use the signed-in maintainer's short-lived OAuth token; BotPassword is available only in explicit local mode
- job history is rebuilt from `output/jobs/*/logs/job.log`
- in OAuth mode, job history, status, results, artifacts, reviews, and publishing are accessible only to the operator who created the job; other maintainers receive a not-found response
- job directories are checked when Web starts and every 24 hours; `output/jobs/<job-id>/` directories last modified more than 30 days ago are removed automatically

## Validation and Troubleshooting

Useful commands:

```bash
npm run check
npm run check:test
npm test
```

Compatibility status: local checks are verified on Node.js `26.7.0` with npm `12.0.2`; Toolforge production is verified on Node.js `26.1.0` with npm `12.0.2`.

Notes:
- keep `.env` out of version control
- job and publish history is retained for up to 30 days; back up `output/jobs/` separately if longer retention is required
- use `sandbox` before `live` when testing new workflow changes

## Project Status

Implemented and working today:
- Web UI for job creation, progress tracking, artifact preview, publish review, and maintenance review
- Commons publishing for voting/result/winners pages
- formal maintenance publishing for winner notifications, central announcements, Previous-page updates, and file assessment templates
- regression coverage for parsers, renderers, Web, job history, and offline workflow fixtures

Maintainer docs:
- Architecture and responsibility boundaries: [docs/architecture.md](docs/architecture.md)

Recommended next steps:
- add a shared encrypted session store before increasing the Toolforge replica count
- expand fixtures for older Commons page variants and unusual signatures
- add end-to-end Web flow coverage for create-voting, count-votes-and-select-winners, and maintenance publish
- consider finer-grained inline word diff inside changed lines

## Useful Resources

- Example environment file: [.env.example](.env.example)
- Original upstream project: [Commons Photo Challenge](https://github.com/jarek-tuszynski/Commons_photo_challenge), by Jarek Tuszynski (public domain)
- Traditional Chinese README: [README.zh-TW.md](README.zh-TW.md)
