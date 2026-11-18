# Round 2 submission — FileSign

**Live demo:** https://astra-sign-sprint.vercel.app
**GitHub (public):** https://github.com/Adeliu4239/astra-sign-sprint

## What I built
FileSign is a self-service agreement-signing workflow for a company that opens one case (file) per client. The office creates a case, uploads the client's agreement as **any PDF**, clicks to place a signature field on any page, and copies a private, expiring signing link. The client opens the link on any device, reviews every page, consents to sign electronically, and draws or types a signature. The server stamps the signature into the PDF at the exact placed coordinates and appends a signing certificate page. It stores the result as a separate, immutable artifact with SHA-256 hashes, and the case turns **Completed** on the dashboard, with a server-recorded event log.

## Demo access (no credentials needed)
1. Open https://astra-sign-sprint.vercel.app → **Open demo workspace**. You get a private workspace tied to that browser (no sign-up).
2. **New case**: enter any synthetic case name, client name and email → **Create case**.
3. Drop or choose a PDF (any number of pages, up to 25 MB).
4. **+ Signature** → click on the page where the client signs (any page, e.g. page 2). Optionally add **Full name** / **Date signed**. Drag to move, drag the corner to resize, ✕ to remove. Placement autosaves.
5. **Create signing link** → **Copy link**.
6. Paste the link into a **private/incognito window** (or another device). Review the pages, draw or type the signature, tick the consent box → **Agree & sign**. Optionally download the signed copy.
7. Back in the first window the case shows **Completed** (it refreshes itself). Click **Download signed PDF**. Opening the signing link again shows "already signed"; it cannot be signed twice.

## Included features and why
- **Arbitrary PDF upload with validation** (PDF magic bytes, full parse of every page, ≤ 300 pages, ≤ 25 MB; clear errors for corrupt, non-PDF or password-required files). The MIND agreement is unseen, so nothing is templated.
- **Chunked upload for large files and streamed PDF responses**: Vercel limits function bodies to ~4.5 MB. Scanned agreements still work (verified with a 9 MB PDF in production).
- **Owner-password ("protected") PDFs are decrypted for signing**: common for business PDFs. Both hashes are logged.
- **Visual field placement on any page** (signature required; name and date optional), with move/resize/delete, keyboard nudging, autosave, and persistence across refresh. This works on any layout without AI.
- **Rotation- and CropBox-aware coordinate mapping**, centralised in `src/lib/pdf/coordinates.ts` and unit-tested for 0/90/180/270° and for page 2. The signature lands where the admin put it.
- **Expiring, single-use signer links**: 256-bit token, only the hash used for lookup, carried in the URL **fragment** so it never reaches server logs or `Referer`. Copy button, "Open signer view", "Email via my mail app" (`mailto:`), revoke, and restart with the same fields.
- **Signer experience**: all pages rendered, highlighted "Sign here" areas with a live preview of the signature in place, draw (mouse/touch/stylus) or type, explicit consent text, and double-submit protection. Works on phones.
- **Atomic, idempotent completion**: row lock + compare-and-set. The artifact, status change and audit events commit in one transaction. Replays get 409 and are logged.
- **Evidence**: original and signed SHA-256, UTC event log (created, link issued, page opened, consent, signed, completed, rejected reuse attempts) shown on the case page. A certificate page inside the signed PDF records signer, consent text, events, original hash and hashed IP.
- **Tenant isolation between demo workspaces**: every admin query is scoped to the workspace. Tested: another workspace gets 404, and a request with no session gets 401.

## Features deliberately omitted and why
- **Server-sent email (e.g. Resend)**: optional per the brief. Copy-link and `mailto:` deliver reliably without faking a send.
- **AI field detection or contract parsing**: unreliable on unseen layouts, and real agreements should not go to third-party AI. Manual placement takes seconds.
- **Accounts/teams**: replaced by isolated, self-service demo workspaces so the evaluator needs no credentials.
- **Multi-signer routing, templates, payments, CRM integrations**: outside the core "one client, one agreement" job.
- **Identity verification / qualified e-signatures / compliance certification**: not claimed. The UI and certificate say so.

## Assumptions and limitations
- A "file" is one case per client with one active signing request.
- Input must be a standard PDF (Word files are not converted). PDFs that need a password *to open* are rejected with instructions.
- The demo workspace lives in a browser cookie. Switching browsers or clearing cookies opens a new, empty workspace. Signing links work anywhere.
- Name/date text fields use Helvetica: characters outside Western European (WinAnsi) print as `?`. The signature image itself is unaffected.
- No rate limiting on workspace creation or uploads (tokens are unguessable and single-use).
- Synthetic data only. This is a prototype with no legal enforceability claim.

## Technology and assistance
- **Stack:** Next.js 16 (App Router, TypeScript strict), Tailwind CSS 4, Zod, PDF.js 6 (viewer), pdf-lib (stamping), @cantoo/pdf-lib (decrypting protected PDFs only), `postgres` driver.
- **Hosting/storage:** Vercel (HTTPS) + Neon Postgres via the Vercel Marketplace. PDFs are stored privately in Postgres (`bytea`), never in a public bucket.
- **Testing:** Vitest (coordinate math, stamping incl. page-2 and rotated-page regressions, state machine, decryption) and Playwright end-to-end against both localhost and the production URL.
- **AI tools used:** Claude Code (Anthropic Claude) as the coding assistant for implementation, tests and docs. The product itself uses no AI.

## Verification
- **Tested at:** first full production run 2026-11-18 18:44 UTC at `0cdff55`; re-run at deployed `53e613e` (application code identical: `0cdff55..53e613e` changes only docs and `playwright.config.ts`). An independent QA pass followed at 20:11–20:20 UTC on deployed `53e613e`; see [`docs/FINAL_QA.md`](FINAL_QA.md).
- **Commands and results:**
  - `npm run typecheck` → pass · `npm run lint` → pass · `npm test` → 33/33 pass · `npm run build` → pass
  - `npm run test:e2e` (local) → 7/7 pass
  - `E2E_BASE_URL=https://astra-sign-sprint.vercel.app npm run test:e2e` → **7/7 pass**
  - `E2E_BROWSERS=chromium,webkit,firefox E2E_BASE_URL=https://astra-sign-sprint.vercel.app npm run test:e2e` → **21/21 pass** (Chromium, WebKit/Safari engine, Firefox)
- **Production scenario (automated):** a freshly generated 3-page PDF (Letter, A4, and a /Rotate 90 page) is uploaded → signature placed on **page 2** and a date on the rotated page 3 → placement survives a refresh → link created → signed in a separate, cookie-less browser context (drawn signature, double-click submit) → the case shows Completed on the case page and dashboard → the downloaded PDF has 4 pages, page 1 untouched, and the page-2 signature image lies inside the placed rectangle (checked by parsing the PDF content stream) → link reuse returns 409, the original becomes 410, and the event log has all events.
- Additional production E2E: non-PDF rejected with a message; invalid/incomplete link messages; a 9 MB PDF via chunked upload with streamed signed download; phone-viewport signer with a typed signature; revoke → link blocked → restart issues a new link; cross-workspace access denied.
- **Visual check:** stamped pages rendered with PDF.js. The signature sits on the "Client signature" line on page 2, and the date reads upright on the rotated page.
- **Known issues:** see limitations above.
- **Independent QA (2026-11-18, production):** two new PDFs (5-page mixed sizes with CropBox offset, signed on p4; 3-page Chromium-generated, signed on p3 from a phone viewport) went end to end. 30 adversarial checks passed (bad, corrupt and password PDFs, 5 concurrent submits → exactly one 201, revoke/restart, expiry (local), cross-workspace 404s, token never in a request URL). No P0 found. Full matrix: `docs/FINAL_QA.md`.
- **Git commit SHA (final):** the last commit before the deadline. Production is redeployed from that exact commit; check with the Vercel deployment's `githubCommitSha`. Application code is unchanged since `0cdff55`; later commits are docs, tests and QA scripts.
