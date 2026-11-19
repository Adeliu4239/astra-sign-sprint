# Round 2 submission — FileSign

**Live demo:** https://astra-sign-sprint.vercel.app
**GitHub (public):** https://github.com/Adeliu4239/astra-sign-sprint

## What I built
FileSign is a self-service agreement-signing workflow for a company that opens one case (file) per client. The office creates a case, uploads the client's agreement as **any PDF**, clicks to place a signature field on any page, and copies a private, expiring signing link. The client opens the link on any device, reviews every page, consents to sign electronically, and draws or types a signature. The server stamps the signature into the PDF at the exact placed coordinates and appends a signing certificate page. It stores the result as a separate, immutable artifact with SHA-256 hashes, and the case turns **Completed** on the dashboard, with a server-recorded event log. For an agreement every client signs, the office can save it once as a **template** and start each new case from it.

## Demo access (no credentials needed)
1. Open https://astra-sign-sprint.vercel.app → **Open demo workspace**. You get a private workspace tied to that browser (no sign-up).
2. **New case**: enter any synthetic case name, client name and email → **Create case**.
3. Drop or choose a PDF (any number of pages, up to 25 MB).
4. **+ Signature** → click on the page where the client signs (any page, e.g. page 2). Optionally add **Full name** / **Date signed**. Drag to move, drag the corner to resize, ✕ to remove. Placement autosaves.
5. **Create signing link** → **Copy link**.
6. Paste the link into a **private/incognito window** (or another device). Review the pages, draw or type the signature, tick the consent box → **Agree & sign**. Optionally download the signed copy.
7. Back in the first window the case shows **Completed** (it refreshes itself). Click **Download signed PDF**. Opening the signing link again shows "already signed"; it cannot be signed twice.

Optional, for an agreement every client signs: **Templates** → name it → upload the PDF → place the fields once. Then in **New case** pick the template; the case starts with its own copy of the PDF and fields, ready for step 5.

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
- **Reusable agreement templates** (optional; direct upload stays the default): save the standard agreement and its field layout once, then start each client case from it. Each case gets its own copy of the PDF and fields in one transaction, so editing or deleting a template never changes existing cases or issued links. Templates can never be sent for signature themselves.
- **Case list that scales past a handful of files**: search by title, client, email or file name (accent- and case-insensitive), status filters with counts, and a next step for each case. Stages are Draft (no PDF or no signature field), Ready (link can be created), Pending, Completed, Expired and Revoked.
- **Non-Latin signer names print correctly**: Chinese, Japanese kana, accented and extended Latin (including Vietnamese), Greek and Cyrillic appear as typed in the name field and on the certificate. OFL-licensed Noto fonts are subset per document with HarfBuzz, so a signed PDF grows only by a few KB. Latin-1 names produce the same output as before.
- **Reliability where real users lose work**: replacing a PDF with placed fields asks first; field saves are serialised so an older save can't overwrite a newer one; a failed save is shown with retry; in-app navigation waits for pending saves and asks if one failed; if the signer's connection drops during submit, the page asks the server whether the signature went through instead of guessing.
- **Abuse and resource limits** (Postgres-backed, shared by all serverless instances): new workspaces 150/hour per IP; upload starts 60/hour per workspace and 150/hour per IP; 150 MB stored per workspace (checked under a row lock, including when a template is copied into a case); at most 3 unfinished large uploads per workspace, expiring after 60 minutes. Breaches return 429/413 with a clear message. Plus CSP, HSTS, COOP, `frame-ancestors 'none'` and no-referrer. Details: `docs/SECURITY_LIMITS.md`.
- **Tenant isolation between demo workspaces**: every admin query, including templates, is scoped to the workspace. Tested: another workspace gets 404, and a request with no session gets 401.

## Features deliberately omitted and why
- **Server-sent email (e.g. Resend)**: optional per the brief, and no verified sending domain was available to test it safely. Copy-link and `mailto:` deliver reliably, and the app never claims an email was sent.
- **AI field detection or contract parsing**: unreliable on unseen layouts, and real agreements should not go to third-party AI. Manual placement takes seconds.
- **Accounts/teams**: replaced by isolated, self-service demo workspaces so the evaluator needs no credentials.
- **Multi-signer routing, payments, CRM integrations**: outside the core "one client, one agreement" job.
- **Automatic field detection on templates or uploads**: placement stays manual and explicit, so the evaluator's unseen agreement behaves exactly like any other PDF.
- **Identity verification / qualified e-signatures / compliance certification**: not claimed. The UI and certificate say so.

## Assumptions and limitations
- A "file" is one case per client with one active signing request.
- Input must be a standard PDF (Word files are not converted). PDFs that need a password *to open* are rejected with instructions.
- The demo workspace lives in a browser cookie. Switching browsers or clearing cookies opens a new, empty workspace. Signing links work anywhere.
- Name/date text: Korean (Hangul), Arabic, Hebrew, Indic scripts, emoji and very rare CJK characters (Extension A and beyond) still print as `?`. The drawn or typed signature image is unaffected.
- Non-ASCII characters in uploaded file names are replaced with `_` in the stored name.
- Rate limits use fixed hourly windows (a burst at a window boundary can briefly reach twice the limit) and count users behind one shared network as one IP. Signing endpoints are not rate-limited; links are 256-bit and single-use.
- Expiry is enforced when a link is used; there is no separate "expired" event until then.
- Synthetic data only. This is a prototype with no legal enforceability claim.

## Technology and assistance
- **Stack:** Next.js 16 (App Router, TypeScript strict), Tailwind CSS 4, Zod, PDF.js 6 (viewer), pdf-lib (stamping), @cantoo/pdf-lib (decrypting protected PDFs only), `postgres` driver.
- **Hosting/storage:** Vercel (HTTPS) + Neon Postgres via the Vercel Marketplace. PDFs are stored privately in Postgres (`bytea`), never in a public bucket.
- **Fonts (Unicode names):** Noto Sans and Noto Sans SC (SIL Open Font License, licence texts in `assets/fonts/`), subset with `harfbuzzjs` and embedded via `@pdf-lib/fontkit`.
- **Testing:** Vitest unit tests (coordinate math, stamping incl. page-2, rotated-page and Unicode regressions, state machine, decryption), Vitest integration tests against a local Postgres (templates, rate limits, quotas, upload sessions), and Playwright end-to-end in Chromium, WebKit and Firefox against both localhost and the production URL.
- **AI tools used:** Claude Code (Anthropic Claude) as the coding assistant for implementation, tests, release checks and docs. The product itself uses no AI.

## Verification
- **Final release (2026-11-19):** application code `a911a9f` (PR #3, hardening) on top of `933bb75` (PR #2, templates); later commits `4f25688` (#5), `d0dd4d3` (#6) and the docs merge (#4) change only tests and docs.
  - Release gates: a Neon recovery branch was taken before any migration; migrations `003_templates.sql` and `004_abuse_limits.sql` are additive and applied in the production build (verified read-only: all existing cases defaulted to `kind = 'client'`, completed requests and signed artifacts untouched).
  - On `main`: `npm run typecheck` pass · `npm run lint` pass · `npm test` **51/51** · `npm run test:integration` **18/18** (local Postgres: templates, rate limits, storage quota incl. template copies, upload sessions) · `npm run build` pass.
  - Production, 2026-11-19 23:00–23:01 UTC on deployment `dpl_3HdtQDypyiJpaZdnkx77iA5sm3R4` (`4f25688`, same application code): `E2E_BROWSERS=chromium,webkit,firefox E2E_BASE_URL=https://astra-sign-sprint.vercel.app npm run test:e2e` → **42/42 pass** (14 scenarios × 3 engines: gold path with page-2 signature and content-stream placement check, upload errors, invalid links, 9 MB chunked upload, phone signer, revoke/restart, workspace isolation, template → two independent cases, case stages/search/filters/empty states, replace confirmation, failed save + navigation guard + retry, two signature fields + long mixed-script name, dropped connection before and after the server signed, duplicate submit 409, no CSP violations).
  - Production refresh regression (`tests/e2e/refresh.spec.ts`, #6) → **9/9 pass** in all three engines: a saved field survives a normal refresh in the same place and the case then signs; a refresh while a save is pending warns and never shows "Saved"; leaving anyway shows the server's real state.
  - Earlier runs today, reported for completeness: the first production run after PR #3 was 40/42 (two Firefox `page.reload` races in the tests right after the Draft→Ready refresh; a probe showed the page did reload and kept the field, fixed in the tests by #5); one later run hit the app's own per-IP workspace limit after ~150 test workspaces in an hour (28/42; the limiter working as designed, the counters were not cleared).
  - Manual production walkthrough (2026-11-19 23:02 UTC, synthetic data): fresh workspace → unfamiliar 4-page PDF (Legal, Letter, A5 landscape, A4) → signature and name fields on page 2 → link → signed on an iPhone-sized screen in a separate session with a typed signature for "Jordan Đặng 李明" → Completed with a 7-event timeline → downloaded 5-page signed PDF rendered: signature and name sit exactly on the placed boxes and print as typed; certificate correct → template created and used for a new Ready case with its own copy of the fields → search and status filters correct → no horizontal overflow on a phone-sized dashboard or case page → no console errors; no legal-compliance or email-sent claims on the pages visited.
- **Earlier baseline (2026-11-18):**
- **Tested at:** first full production run 2026-11-18 18:44 UTC at `0cdff55`; re-run at deployed `53e613e` (application code identical: `0cdff55..53e613e` changes only docs and `playwright.config.ts`). An independent QA pass followed at 20:11–20:20 UTC on deployed `53e613e`; see [`docs/FINAL_QA.md`](FINAL_QA.md).
- **Commands and results:**
  - `npm run typecheck` → pass · `npm run lint` → pass · `npm test` → 33/33 pass · `npm run build` → pass
  - `npm run test:e2e` (local) → 7/7 pass
  - `E2E_BASE_URL=https://astra-sign-sprint.vercel.app npm run test:e2e` → **7/7 pass**
  - `E2E_BROWSERS=chromium,webkit,firefox E2E_BASE_URL=https://astra-sign-sprint.vercel.app npm run test:e2e` → **21/21 pass** (Chromium, WebKit/Safari engine, Firefox)
- **Production scenario (automated):** a freshly generated 3-page PDF (Letter, A4, and a /Rotate 90 page) is uploaded → signature placed on **page 2** and a date on the rotated page 3 → placement survives a refresh → link created → signed in a separate, cookie-less browser context (drawn signature, double-click submit) → the case shows Completed on the case page and dashboard → the downloaded PDF has 4 pages, page 1 untouched, and the page-2 signature image lies inside the placed rectangle (checked by parsing the PDF content stream) → link reuse returns 409, the original becomes 410, and the event log has all events.
- Additional production E2E: non-PDF rejected with a message; invalid/incomplete link messages; a 9 MB PDF via chunked upload with streamed signed download; phone-viewport signer with a typed signature; revoke → link blocked → restart issues a new link; cross-workspace access denied.
- **Visual check:** stamped pages rendered with PDF.js. The signature sits on the "Client signature" line on page 2, and the date reads upright on the rotated page.
- **Templates release (2026-11-19, deployed `933bb75`, `dpl_2Z8CFritq4Gnscfw32C1ZhMPm7Uh`):** a Neon recovery branch was taken before the release; additive migration `003_templates.sql` applied in the production build (existing 84 cases defaulted to `kind = 'client'`; 42 completed requests untouched). Checks on `main`: typecheck, lint, unit 33/33, integration 6/6 (local Postgres), build pass. Production `E2E_BROWSERS=chromium,webkit,firefox` → **24/24 pass** on re-run. The first run was 23/24: one Firefox test-timing failure (`page.reload` aborted by an in-flight client refresh right after a confirmed save, no data effect); the template scenario then passed 9/9 across all three engines with `--repeat-each=3`.
- **Known issues:** see limitations above.
- **Independent QA (2026-11-18, production):** two new PDFs (5-page mixed sizes with CropBox offset, signed on p4; 3-page Chromium-generated, signed on p3 from a phone viewport) went end to end. 30 adversarial checks passed (bad, corrupt and password PDFs, 5 concurrent submits → exactly one 201, revoke/restart, expiry (local), cross-workspace 404s, token never in a request URL). No P0 found. Full matrix: `docs/FINAL_QA.md`.
- **Git commit SHA (final):** `main` HEAD at submission, deployed to production; verify with the deployment's `githubCommitSha`. Application code is `a911a9f`; later commits change only tests and docs.
