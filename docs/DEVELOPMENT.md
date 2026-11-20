# Development

## Environment setup

Requires Node.js 20+, npm and Docker.

```bash
docker run -d --name filesign-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=filesign -p 54329:5432 postgres:17-alpine
cp .env.example .env.local
npm install            # postinstall copies PDF.js assets into public/pdfjs
npm run db:migrate
npm run dev            # http://localhost:3000
```

### Environment variables (`.env.local`)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://postgres:dev@localhost:54329/filesign` for the container above. On Vercel it is injected by the Neon integration. |
| `APP_SECRET` | yes | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. It encrypts pending signer links and keys IP hashes. Changing it hides existing pending links. |
| `PUBLIC_BASE_URL` | no | Base URL for signer links. Defaults to the request origin. |

Never commit `.env*` files other than `.env.example`.

### Database migrations
- `npm run db:migrate` applies each unapplied `db/migrations/*.sql` file in name order, inside a transaction, and records it in `schema_migrations`.
- To add a migration, create the next numbered file.
- **Migrations must be additive and backward compatible.** Add columns with defaults and use `if not exists`. Never drop or rewrite data. The previously deployed release must keep working on the new schema.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run test:integration` | Service-layer tests against local Postgres |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npx tsx scripts/make-test-pdf.ts out.pdf` | Generate a synthetic 3-page PDF with mixed page sizes and a rotated page |
| `node scripts/render-pdf-page.mjs <file.pdf> <page> <out.png>` | Render a PDF page to PNG to inspect stamping |

## Tests

| Suite | Location | Covers |
|---|---|---|
| Unit | `tests/unit` | Coordinate mapping (all rotations, CropBox, page 2), stamping (unbalanced transforms, rotated pages, text fields, certificate), Unicode text extraction, request state machine, case stages and search, owner-password decryption |
| Integration | `tests/integration` | Templates (snapshot independence, guards, isolation); rate limits (including 25 concurrent hits); storage quota (including concurrency and template copies); upload-session cap, expiry and retry |
| End-to-end | `tests/e2e` | See the list below |

The end-to-end suite covers:
- the gold path: a fresh multi-page PDF, a signature on page 2, a separate signer browser, and a check that the stamp lands in the placed rectangle;
- non-PDF and invalid-link errors;
- a 9 MB chunked upload;
- a phone signer;
- revoke and restart;
- workspace isolation;
- templates;
- case stages, search and filters;
- the confirmation before replacing a PDF;
- a failed save with retry;
- Unicode names;
- a dropped connection, both before and after the server signs;
- refresh during and after field saves.

E2E tests generate their PDFs at runtime (`tests/e2e/make-pdf.ts`), so no fixture is committed.

### Integration tests
They load `.env.local` and refuse any `DATABASE_URL` that isn't `localhost` or `127.0.0.1` (`tests/support/load-env.ts`). Start the Docker database and run `npm run db:migrate` first.

### End-to-end tests

```bash
npm run test:e2e                                        # Chromium; starts `npm run dev` if nothing is on :3000
E2E_BROWSERS=chromium,webkit,firefox npm run test:e2e   # all three engines
E2E_BASE_URL=https://astra-sign-sprint.vercel.app npm run test:e2e   # against a deployment
npx playwright test tests/e2e/refresh.spec.ts           # a single spec
```

Install browsers once with `npx playwright install chromium webkit firefox`. Traces, videos and screenshots are disabled in `playwright.config.ts`, because signer links are secrets.

**Browser-specific notes:**
- **WebKit:** drops `Secure` cookies on `http://localhost`. Run WebKit against the dev server, where the cookie isn't marked `Secure`, or against an HTTPS deployment, not against a local `next start`.
- **Firefox:** a `page.reload()` that lands while the app is running `router.refresh()` (for example right after a field save flips Draft to Ready) can fail with `NS_BINDING_ABORTED`. Wait for the visible end state, such as the **Ready** badge, before reloading.
- **To test the production build locally** (Chromium or Firefox), run `npm run build && npx next start -p 3100` and then `E2E_BASE_URL=http://localhost:3100 npm run test:e2e`.

**Rate limits during E2E:**
- Every test creates a demo workspace, and a three-engine run creates about 48.
- Production allows 150 new workspaces per IP per hour, so run at most about three full suites per hour against a deployment. Never clear production counters.
- Locally, every request shares one IP bucket. If tests start failing with `rate_limited`, clear the **local** table with `psql postgres://postgres:dev@localhost:54329/filesign -c "delete from rate_limit_counters"`.

## Git workflow

- **Branches:** `main` is production. Never commit or push to it directly. Cut one scoped branch per task from an up-to-date `main`:
  ```bash
  git switch main && git pull --ff-only origin main
  git switch -c fix/<short-purpose>        # or feat/ docs/ test/ chore/
  ```
- **Commits:** small commits with Conventional Commit prefixes (`fix:`, `test:`, `docs:`, `chore:`).
- **History:** never force-push, never `reset --hard` a pushed branch, never rewrite history, never move or delete tags. `round2-validated` is a frozen baseline.
- **Before opening a PR:**
  ```bash
  npm run typecheck && npm run lint && npm test && npm run build
  npm run test:integration                # when the service layer or migrations change
  npm run test:e2e                        # when the critical flow changes (upload → fields → link → sign → signed PDF → status)
  ```
- **PR description:** follow `.github/pull_request_template.md`: what and why, risk, rollback, and the commands actually run with their real results.
- **Merging:** the repository owner approves every merge, and there is no auto-merge. Squash-merge, then delete the branch.
- **New features:** user-visible features need approval before implementation.

## Release

Vercel doesn't deploy from Git. Production deploys are deliberate:

```bash
git switch main && git pull --ff-only origin main && git status --porcelain   # must print nothing
vercel deploy --prod --yes                                                     # runs migrations, then builds
vercel inspect astra-sign-sprint.vercel.app                                    # note the deployment ID
vercel api /v13/deployments/<id> | jq -r .meta.githubCommitSha                 # must equal `git rev-parse HEAD`
E2E_BASE_URL=https://astra-sign-sprint.vercel.app npm run test:e2e
```

- **Before a migration**, create a Neon branch of the production database as a recovery point.
- **Previews:** don't use Preview deployments. They share the production `DATABASE_URL` and would run migrations against it.
- **Docs-only merges** still need a redeploy, so the deployed SHA equals `main` HEAD, and a smoke run.

## Rollback
1. **Production first:** run `vercel rollback` or `vercel promote <known-good-deployment-url>`, then rerun the production E2E.
2. **Then code:** open a `revert/<purpose>` branch with `git revert <sha>`, and take it through a PR, approval, merge and redeploy. Never reset `main`.
3. **Database:** migrations are additive, so the previous release runs on the current schema. Never drop tables or delete signed artifacts. To recover data, use the Neon recovery branch.

## Data hygiene
- Use synthetic people and documents only.
- Never commit any of these:
  - secrets or `.env*` files (other than `.env.example`);
  - `.vercel/`;
  - signer tokens or links, or screenshots that show them;
  - raw test output (`test-results/`, `playwright-report/`, `qa/artifacts/`);
  - generated PDFs.
- Never edit production data by hand. Stored signed PDFs and completed requests are immutable.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| PDF viewer blank or worker 404 | `public/pdfjs` is missing. Run `npm install` (postinstall) or `node scripts/copy-pdfjs-assets.mjs`. |
| `relation … does not exist` | Migrations haven't run. Run `npm run db:migrate`. |
| Integration tests refuse to start | `DATABASE_URL` isn't local. Point `.env.local` at the Docker database. |
| Many E2E tests fail at once on a local `next start` | Another server is already on that port. Stop it and rerun. |
| E2E redirected with `?error=rate_limited` | The hourly workspace limit was reached. Locally, clear `rate_limit_counters`; against production, wait for the next UTC hour. |
| WebKit E2E can't keep the session locally | WebKit drops `Secure` cookies on http. Use the dev server or an HTTPS deployment. |
| Pending signer links show as unavailable | `APP_SECRET` changed. Revoke and restart the request to issue a new link. |
