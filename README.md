# FileSign

FileSign gets a client's agreement signed on every file a company opens. An office user creates a case for a client, uploads the agreement as a standard PDF (or starts from a saved template), places a signature field on the right page and shares a private signing link. The client reviews and signs on any device. FileSign returns a signed PDF with the signature stamped exactly where it was placed, plus a certificate page and a server-side audit trail.

**Live demo:** https://astra-sign-sprint.vercel.app. Click **Open demo workspace**; no sign-up is needed.

## Core workflows

### Sign an arbitrary PDF

1. Create a case with the client's name and email.
2. Upload a standard PDF of up to 25 MB and 300 pages. Files that need a password to open, are malformed or exceed the limits are rejected with a message.
3. Place a signature field on any page; name and date fields are optional. Drag to move, drag the corner to resize. Changes autosave.
4. Click **Create signing link** and copy it, or open it in your mail app.
5. The client opens the link in any browser, reviews every page, consents, draws or types a signature and submits once.
6. The case turns **Completed**. Download the signed PDF.

### Reuse a standard agreement

1. Under **Templates**, upload the agreement once and place its fields.
2. Pick the template when creating a case. The case gets its own copy of the PDF and fields, ready to send.
3. Editing or deleting the template later never changes existing cases or links already issued.

## Features
- **PDF intake:** accepts standard PDFs of up to 25 MB and 300 pages. Every upload is validated: PDF file signature, a full parse of every page, and the size and page limits. Malformed or truncated files, non-PDF files, oversized files and PDFs that need a password to open are rejected with a clear message; Word and other formats are not converted. PDFs with only an owner password (editing restrictions) are decrypted. Files over 3 MB upload in chunks.
- **Field placement:** correct on pages of different sizes, on rotated pages and on pages with offset crop boxes.
- **Signing links:** 256-bit, expiring (14 days) and single-use. The server looks tokens up by their SHA-256 hash. While a link is pending, it also keeps an AES-256-GCM encrypted copy, keyed from `APP_SECRET`, so the admin can copy the link again; that copy is deleted when the request is completed or revoked. The token sits in the URL fragment, so it never reaches server logs. Links can be revoked and reissued.
- **Signer page:** works on phones. Draw or type a signature, with explicit consent and protection against double submission. If the connection drops, the page asks the server whether the signature went through.
- **Atomic completion:** the signed artifact, status change and audit events commit in one transaction. A second attempt is refused and logged.
- **Evidence:** SHA-256 of the original and signed PDFs, a UTC event log, and a certificate page appended to the signed PDF.
- **Non-Latin names:** Chinese, Japanese kana, extended Latin (including Vietnamese), Greek and Cyrillic print as typed, using OFL Noto fonts subset per document.
- **Case list:** search, status filters (Draft, Ready, Pending, Completed, Expired, Revoked) and a next step for each case.
- **Abuse limits:** database-backed rate limits, a storage quota per workspace and strict security headers.

## Architecture
- **App:** a single Next.js 16 application (App Router, TypeScript strict).
- **Server:** route handlers validate input with Zod and call one service layer. Every admin query is scoped to the caller's workspace.
- **Storage:** PostgreSQL (Neon in production) holds all records and the PDF bytes, so a signature, its artifact and its audit events commit together.
- **PDFs:** PDF.js renders them in the browser and pdf-lib stamps them on the server.
- **Hosting:** Vercel. Migrations run during the production build.

Stack: Next.js 16 · React 19 · Tailwind CSS 4 · Zod · PostgreSQL (`postgres` driver) · PDF.js · pdf-lib · HarfBuzz (font subsetting) · Vitest · Playwright.

## Quick start
Requires Node.js 20+ and Docker.

```bash
docker run -d --name filesign-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=filesign -p 54329:5432 postgres:17-alpine
cp .env.example .env.local      # then set APP_SECRET (see below)
npm install                     # also copies the PDF.js runtime assets into public/pdfjs
npm run db:migrate
npm run dev                     # http://localhost:3000
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Locally, the Docker container above. |
| `APP_SECRET` | yes | 32+ random characters. Encrypts pending signer links at rest so an admin can copy them again. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. |
| `PUBLIC_BASE_URL` | no | Base URL for signer links. Defaults to the request origin. |

### Database migrations
SQL files in `db/migrations/` are applied in order by `npm run db:migrate` and recorded in `schema_migrations`. Production runs them automatically through `vercel-build`. Migrations are additive only.

## Tests

```bash
npm run typecheck && npm run lint
npm test                         # unit: coordinates, stamping, Unicode text, state machine, decryption
npm run test:integration         # service layer against local Postgres (refuses non-local databases)
npm run test:e2e                 # Playwright against a local dev server (Chromium)
E2E_BROWSERS=chromium,webkit,firefox npm run test:e2e
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for browser-specific notes and running against a deployment.

## Security and known limitations
- **Not a qualified signature.** FileSign records consent, a signature image, hashes and an audit trail. It does not verify identity and makes no claim of legal enforceability or regulatory compliance. The SHA-256 values are integrity fingerprints, not a cryptographic PDF signature.
- **Demo access:** a demo workspace is tied to one browser cookie. There are no accounts or teams.
- **No server email:** links are shared by copy or through the user's own mail app. FileSign never claims an email was sent.
- **One signer per case.**
- **Unsupported scripts:** Korean, Arabic, Hebrew, Indic scripts, emoji and rare CJK characters print as `?` in the name and date fields. The signature image is unaffected.
- **File names:** non-ASCII characters in uploaded file names are stored as `_`.
- **Rate limits:** fixed hourly windows, and users behind one shared network count as one IP.

## Documentation
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): components, data model, signing pipeline, security controls and invariants.
- [docs/DESIGN_DECISIONS.md](docs/DESIGN_DECISIONS.md): product and technical trade-offs, exclusions and roadmap.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): setup, testing, Git workflow, release and rollback.
