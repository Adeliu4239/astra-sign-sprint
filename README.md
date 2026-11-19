# FileSign — agreement signing for client files

A company opens one **case (file) per client**, uploads the client's agreement PDF, places a signature field on any page, shares a private signing link, and gets back a signed PDF with the signature stamped at the exact position — plus a server-side audit log.

**Live demo:** https://astra-sign-sprint.vercel.app (click **Open demo workspace**, no sign-up)

Built for the Astra AI Round 2 challenge.

> Status and verification details live in [`docs/SUBMISSION.md`](docs/SUBMISSION.md). Decisions and trade-offs: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Try it
1. Open the deployed URL and click **Open demo workspace** (no sign-up; the workspace is private to that browser via an httpOnly cookie).
2. Create a case with a synthetic client name and email.
3. Upload any PDF (≤ 25 MB, any number of pages; files over 3 MB upload in chunks).
4. Pick **+ Signature** and click on any page where the client should sign (optionally add *Full name* / *Date signed*). Drag to move, drag the corner to resize, ✕ to remove. Placement autosaves.
5. Click **Create signing link** and **Copy link**.
6. Open the link in a private/incognito window: review the pages, draw or type a signature, tick consent, **Agree & sign**.
7. Back in the admin tab the case turns **Completed** (auto-refreshes). Download the signed PDF. It has the signature at the placed position plus a signing certificate page.

## What is implemented (verified on production)
- Self-service demo workspace per browser, case creation; case list with search (title, client, email, file; accent-insensitive), status filters and a next step per case (Draft / Ready / Pending / Completed / Expired / Revoked)
- PDF upload with validation (magic bytes, full parse, ≤ 300 pages, ≤ 25 MB); owner-protected PDFs decrypted, password-to-open PDFs rejected with instructions
- Field placement (signature required, name/date optional) on any page, rotation/CropBox-aware
- Expiring single-use signer link (token hashed at rest, kept in the URL fragment so it never reaches server logs); copy, `mailto:`, revoke, restart
- Signer: review all pages, draw or type, explicit consent, double-submit safe, mobile-friendly
- Server-side stamping, immutable signed artifact + SHA-256 (an integrity fingerprint, not a cryptographic PDF signature), signing certificate page, UTC event log
- Signer names in Chinese, Japanese kana, accented/extended Latin (incl. Vietnamese), Greek and Cyrillic print as typed in the signed PDF (OFL Noto fonts, `assets/fonts/README.md`)
- Reliability: replace-PDF asks before discarding placed fields; field saves are serialised and failures are visible with retry; in-app navigation waits for pending saves; a dropped connection while signing is resolved by asking the server
- Abuse and resource limits in Postgres (rate limits, 150 MB storage quota per workspace, upload-session caps) and security headers (CSP, HSTS, COOP): `docs/SECURITY_LIMITS.md`
- Not implemented: server-sent email, accounts/teams, multi-signer. See `docs/DECISIONS.md`

**Reusable agreement templates**: save a PDF plus its field layout once under **Templates**, then pick it in the new-case form. Each case gets its own copy of the PDF and fields in one transaction, so later template edits or deletion never change existing cases. Direct upload stays the default. Design: `docs/PRODUCT_GAP_ANALYSIS.md`.

## Stack
Next.js 16 (App Router, TypeScript strict) · Tailwind CSS 4 · PostgreSQL (`postgres` driver; PDFs stored privately as `bytea`) · PDF.js (viewer) · pdf-lib (stamping) · Zod (validation) · Vitest + Playwright · Vercel + Neon.

## Local development
```bash
docker run -d --name filesign-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=filesign -p 54329:5432 postgres:17-alpine
cp .env.example .env.local     # then set APP_SECRET to a random value
npm install                    # also copies the PDF.js worker into public/
npm run db:migrate
npm run dev                    # http://localhost:3000
```

## Checks
```bash
npm run typecheck && npm run lint && npm test   # unit tests (coordinates, stamping, state machine)
npm run test:integration                        # DB-backed service tests (LOCAL Postgres only; refuses non-localhost URLs)
npm run test:e2e                                # Playwright suites against local dev server
E2E_BASE_URL=https://<deployment> npm run test:e2e   # same suite against a deployment
E2E_BROWSERS=chromium,webkit,firefox npm run test:e2e  # all three engines
npx tsx scripts/make-test-pdf.ts out.pdf        # fresh synthetic 3-page PDF (mixed sizes, rotated page)
```

## Layout
- `src/lib/pdf/coordinates.ts` — the single viewer↔PDF coordinate contract (normalised, rotation-aware)
- `src/lib/pdf/stamp.ts` — server-side stamping + signing certificate page
- `src/lib/server/service.ts` — all DB operations, workspace scoping, chunked uploads, signing transaction
- `src/app/api/**` — route handlers; `src/app/sign` — public signer page (token read from `#fragment`)
- `db/migrations` — SQL migrations (run by `npm run db:migrate`, and automatically in `vercel-build`)
