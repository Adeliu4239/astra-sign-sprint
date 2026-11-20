# CLAUDE.md — FileSign

FileSign is a self-service agreement-signing app. An admin creates a case per client, uploads a standard PDF (or uses a template), places fields, and shares a single-use signing link. The server stamps the signature at the exact coordinates and stores an immutable signed PDF with hashes and an audit trail. Production: https://astra-sign-sprint.vercel.app (`main`).

Read `docs/ARCHITECTURE.md` before changing server, PDF or data code. Record significant trade-offs in `docs/DESIGN_DECISIONS.md`. Workflow and commands are in `docs/DEVELOPMENT.md`.

## Source layout
- `src/app/**/page.tsx`: admin pages (dashboard, case, templates) and the client-rendered signer page (`/sign#token`).
- `src/app/api/**/route.ts`: thin route handlers. They validate with Zod (`src/lib/schemas.ts`), resolve the caller, call the service layer, and map `HttpError`.
- `src/lib/server/service.ts`: all database access, transactions and workspace scoping. `session.ts`, `crypto.ts`, `limits.ts` and `http.ts` support it.
- `src/lib/pdf/`: `coordinates.ts` (the only viewer↔PDF conversion), `stamp.ts` (stamping and certificate), `unicode-fonts.ts`, `decrypt.ts`.
- `src/lib/signing/state.ts`: request state machine and derived expiry.
- `db/migrations/`: SQL migrations, applied by `scripts/migrate.ts`.
- `tests/{unit,integration,e2e}`.

## Domain invariants (do not break)
1. **Workspace scoping:** every admin query is scoped by `cases.workspace_id`. Foreign IDs return 404; no session returns 401. Signer routes authenticate only with the `x-signing-token` header, never the cookie.
2. **Atomic signing:** completion is one transaction. Lock the request (`for update`), check that it is `pending` and not expired, stamp, insert the signed document, set `completed`, and log events. Never show success or send anything before the commit.
3. **Immutability:** a completed request can't be signed again. Signed PDFs and completed requests are never updated or deleted, in code or by hand.
4. **Coordinates:** fields are normalized (0–1) in the displayed page space and converted to PDF space only through `src/lib/pdf/coordinates.ts`, which accounts for CropBox and `/Rotate`. Any change needs unit tests, including a field on page 2 and on a rotated page.
5. **Template snapshots:** using a template copies its PDF and fields into new rows. Cases never share mutable rows with templates, and templates can't be sent.
6. **Tokens:** store only the hash plus the encrypted copy. Keep tokens in the URL fragment and the header. Never put them in query strings, logs, events, screenshots or test artifacts.
7. **No false claims:** don't claim legal enforceability, identity verification, compliance or that an email was sent.

## Git and PR workflow
- `main` is production. Never commit or push to `main` directly, including docs-only changes.
- One scoped branch per task (`feat/`, `fix/`, `docs/`, `test/`, `chore/`), small Conventional Commits, and a PR using `.github/pull_request_template.md` with the real commands and results.
- Merge only with the owner's explicit approval, by squash. Never auto-merge.
- Never force-push, `reset --hard`, rewrite history, or move or delete tags. `round2-validated` is frozen.
- New user-visible features need approval before implementation. Don't refactor beyond the task.

## Testing requirements
- Before review, run `npm run typecheck && npm run lint && npm test && npm run build`.
- Changes to the service layer or migrations also need `npm run test:integration`, which uses local Postgres only.
- Changes to the critical flow (upload → fields → link → sign → signed PDF → status) also need `npm run test:e2e` locally.
- Don't claim a test passed or a build works unless you ran it. Report failures with their output.
- Production E2E creates real demo workspaces and counts against the per-IP rate limit. Don't repeat suites needlessly, and never clear production counters.

## Migrations and deployment
- Migrations are additive and backward compatible: no drops, no destructive rewrites. The previous release must run on the new schema.
- Take a Neon recovery branch before a production migration.
- Deploy only from a clean `main` at the approved merge SHA (`vercel deploy --prod --yes`). Then verify that the deployment's `githubCommitSha` equals `main` HEAD, and run the production E2E.
- Don't use Preview deployments: they share the production database and would run migrations against it.
- To roll back, promote the last known-good deployment, then fix forward with a `git revert` PR. Never reset `main`.

## Security and data
- Use only synthetic people and documents. Never send agreements to third-party AI services.
- Never commit `.env*` (except `.env.example`), `.vercel/`, secrets, signer links or tokens, raw test output or generated PDFs.
- Validate all input at the boundary with Zod. Every user-facing async action shows loading, success or an actionable error.
