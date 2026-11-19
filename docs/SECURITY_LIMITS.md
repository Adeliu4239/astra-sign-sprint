# Security and resource limits

Branch `feat/final-product-hardening`. **Not in production until that PR is approved, merged and deployed.**
Constants: `src/lib/limits.ts`. Tests: `tests/integration/limits.test.ts` (local Postgres only).

## Thresholds

| Control | Limit | Scope | Enforcement | On breach |
|---|---|---|---|---|
| New demo workspaces | 60 per hour | client IP (keyed hash, never stored raw) | Postgres fixed-window counter: `INSERT … ON CONFLICT DO UPDATE … RETURNING` (atomic across serverless instances) | Home page shows "Too many demo workspaces…" (fixed text, nothing reflected from the URL); API 429 + `Retry-After` |
| Upload starts (single upload or chunked init) | 60 per hour | workspace | same counter | 429 + `Retry-After`; message shown in the upload box |
| Upload starts | 150 per hour | client IP | same counter | same |
| Stored PDF bytes | 150 MB | workspace (originals + signed copies) | Checked inside the upload transaction under a `SELECT … FOR UPDATE` lock on the workspace row, so concurrent uploads cannot both slip under the limit. Also checked at chunked-upload start, before any bytes are sent | 413 "storage limit … open a new demo workspace" |
| Concurrent chunked uploads | 3 | workspace | Counted under the same workspace lock | 429. A new upload on the **same case** replaces that case's unfinished session, so retries are never blocked |
| Unfinished chunked-upload session | 60 minutes | session | Expired sessions reject chunks/complete (404) and are deleted on the next upload start | "Upload not found or expired. Please start the upload again." |
| File size / pages / fields / signature image | 25 MB / 300 / 60 / 600 KB | per request | unchanged (Zod + server checks) | 413/422 with a message |

**Why these numbers:**
- A full three-browser E2E run creates about 35 workspaces from one IP.
- An evaluator creates one workspace and a handful of uploads.
- A small firm working all day stays well below 60 uploads per hour.
- The Neon Free plan has a small total storage allowance. 150 MB per workspace stops one browser from filling it, while still allowing six maximum-size (25 MB) PDFs, or hundreds of typical agreements.

**Replaced drafts:** replacing a draft PDF deletes the replaced original, but only when no request references it. Signed artifacts and completed requests are never deleted.

## Headers (all routes)
- `Content-Security-Policy`:
  - `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
  - `'unsafe-inline'` for scripts is required by the App Router's inline bootstrap, since there is no nonce pipeline. `'wasm-unsafe-eval'` is for the pdf.js image decoders.
  - `'unsafe-eval'` is **not** allowed in production. Zod runs `jitless`, so it doesn't even probe for eval.
  - E2E asserts no CSP violations appear in the console during the admin and signer flows.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`
- `Cross-Origin-Opener-Policy: same-origin`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Permissions-Policy` (camera, microphone and geolocation off)

## Authorization review (all PDF and case routes)
- **Admin routes** (`/api/cases/**`, `/api/uploads/**`, `/api/requests/**`, `/api/documents/[id]`) call `requireWorkspace()`. Every query joins `cases.workspace_id`, so a foreign ID returns 404 and a missing session returns 401. E2E covers this in "another workspace cannot open…".
- **Signer routes** (`/api/sign/*`) take the token only from the `x-signing-token` header. Only its hash is looked up. An invalid token returns a generic `invalid` or 404, with no detail about why.
- **Templates (PR #2):** the template routes use the same `requireWorkspace()` and join on `workspace_id`. This branch does not include them.

## Error privacy
- Unhandled errors return a generic 500. Only `err.message` is logged, and never the URL or the token.
- Signer URLs live in the fragment, so tokens never reach access logs.
- 429 responses carry only a generic message and `Retry-After`.

## Assumptions and limits of these controls
- **Client IP** comes from Vercel's `x-forwarded-for`, which is trusted on Vercel. Locally every request lands in one `unknown` bucket.
- **Fixed windows:** a burst can straddle two windows, allowing up to twice the limit in a short time. That's acceptable for abuse damping; this isn't a precise quota.
- **IP limits:** users behind one NAT share the per-IP limits. The per-IP numbers are set high for that reason.
- **Signing endpoints aren't rate-limited.** Tokens are 256-bit and single-use, so guessing them is infeasible, and replays are refused and logged.
- **Not covered:** platform-level DDoS (Vercel's firewall handles that) and per-workspace case-count limits. Cases are small rows.
