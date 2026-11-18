# FileSign — agreement signing for client files

A company opens one **case (file) per client**, uploads the client's agreement PDF, places a signature field on any page, shares a private signing link, and gets back a signed PDF with the signature stamped at the exact position — plus a server-side audit log.

Built for the Astra AI Round 2 challenge. Deadline: 2026-11-20 01:21 AM EST.

> Status and verification details live in [`docs/SUBMISSION.md`](docs/SUBMISSION.md). Decisions and trade-offs: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Try it
1. Open the deployed URL and click **Open demo workspace** (no sign-up; the workspace is private to that browser via an httpOnly cookie).
2. Create a case with a synthetic client name and email.
3. Upload any PDF (≤ 4 MB, any number of pages).
4. Pick **+ Signature** and click on any page where the client should sign (optionally add *Full name* / *Date signed*). Drag to move, drag the corner to resize, ✕ to remove. Placement autosaves.
5. Click **Create signing link** and **Copy link**.
6. Open the link in a private/incognito window: review the pages, draw or type a signature, tick consent, **Agree & sign**.
7. Back in the admin tab the case turns **Completed** (auto-refreshes). Download the signed PDF.

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
npm run test:e2e                                # Playwright golden path against local dev server
E2E_BASE_URL=https://<deployment> npm run test:e2e   # same suite against a deployment
npx tsx scripts/make-test-pdf.ts out.pdf        # fresh synthetic 3-page PDF (mixed sizes, rotated page)
```

## Layout
- `src/lib/pdf/coordinates.ts` — the single viewer↔PDF coordinate contract (normalised, rotation-aware)
- `src/lib/pdf/stamp.ts` — server-side stamping + signing certificate page
- `src/lib/server/service.ts` — all DB operations, workspace scoping, signing transaction
- `src/app/api/**` — route handlers; `src/app/sign/[token]` — public signer page
- `db/migrations` — SQL migrations (run by `npm run db:migrate`, and automatically in `vercel-build`)
