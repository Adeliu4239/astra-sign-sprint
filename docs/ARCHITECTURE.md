# Architecture and implementation contracts

## Primary components
Browser admin dashboard → authenticated server actions/API → database and private object storage.
Public signer page → server validates one-time high-entropy token → reads original PDF (authorized signed access or streaming) → consent + signature submission → server stamps PDF → immutable signed artifact → database state transition + audit event.

**Suggested stack:** Next.js App Router + TypeScript + Tailwind; PostgreSQL/Supabase for relational records; private Supabase Storage for PDFs; PDF.js (or react-pdf) viewer; pdf-lib PDF manipulation; Playwright; Resend optional. Dev can choose variants with rationale in decision log.

## Minimal domain model
- `organizations(id, name, created_at)`
- `users(id, organization_id, email, role)` or bounded, clearly advertised demo access
- `cases(id, organization_id, client_name, client_email, title, status, created_at)`
- `documents(id, case_id, original_storage_path, original_sha256, mime, size, page_count, created_at)`
- `signing_requests(id, case_id, document_id, token_hash, expires_at, status, created_at, sent_at, completed_at, signed_storage_path, signed_sha256)`
- `signature_fields(id, signing_request_id, page_index, x, y, width, height, required)`
- `signing_events(id, signing_request_id, event_type, occurred_at, metadata_json)`

Field placement uses **PDF-space** coordinates. Agree on origin convention before writing UI and server; for example x/y in PDF points from bottom-left, zero-indexed page. If UI stores normalized coordinates, document transform and use the same utility on viewer and server.

## State machine
`draft` → `pending` → `completed`
`pending` → `expired` | `revoked`
Disallow transitions out of `completed`. Signing submission must be atomic/idempotent (check status and token, lock or compare-and-swap). Do not send an email or display success before persistence is committed.

## Signing and evidence contract
1. Authorized admin uploads original PDF to private storage. Record SHA-256.
2. Admin previews and positions required signature field. Persist page index and bounding rectangle.
3. Issue high-entropy unguessable signer secret; store only hashed secret. Share HTTPS URL with secret; set expiration. Avoid leaking it in third-party logs/referrers.
4. Signer accesses a read-only preview; independently affirmatively agrees to electronic signature and indicates signing intent.
5. On submit, server checks live token, request state and required field, validates signature data, stamps signature, creates signed PDF, records signed SHA-256 and UTC audit event. Use transaction/compensation to avoid completed state with missing artifact.
6. Completed artifact never silently mutates. Signed PDF retrieval is protected by admin session or a restricted signer-completion route.

## PDF coordinate handling (high risk)
- Preserve PDF page selection; support different page dimensions.
- Account for zoom, CSS display size, devicePixelRatio, scrolling and PDF rotation.
- Centralize conversions in `lib/pdf/coordinates.ts` with unit tests (top-left UI to bottom-left PDF convention if applicable).
- For typing or drawing signatures, convert to a raster or embed text in bounded signature rectangle; prevent clipping and overflow.
- PDF signed area should appear where the admin preview indicated, not at a hardcoded bottom-right coordinate.

## Security baseline
- Strong upload validation; limit bytes/pages; never execute uploaded PDF or render raw HTML from content.
- Private originals and executed documents; scoped access checks on every case/document route.
- Rate-limit and expire signer URL; avoid logging URL tokens; no tokens in events beyond hashes.
- Verify all mutations server-side, sanitize filenames, and display UTC timestamps consistently.
- No actual legal/customer PII; use synthetic data only.

## Suggested app routing
`/` landing / demo entry; `/dashboard` cases; `/cases/new`; `/cases/[id]` detail and PDF preparation; `/sign/[token]` unauthenticated signing; `/sign/[token]/complete` completion; `/api/...` server operations. Adjust to framework patterns, keep paths stable and intuitive.

## Deployment contract
Public HTTPS preview, repeatable DB migrations, production secrets only in hosting, env example with descriptions. Ensure production RLS/service-role access patterns are audited. No client-visible service-role credentials. Document smoke test for original upload → signed PDF download at live URL.

---

## As built (2026-11-18) — deviations from the plan above

**Stack:** Next.js 16 App Router (TypeScript strict) on Vercel · Neon Postgres via Vercel Marketplace (`postgres` driver) · PDF.js 6 (legacy build) viewer · pdf-lib stamping (+ `@cantoo/pdf-lib` only to decrypt owner-protected PDFs) · Zod at every API boundary · Vitest + Playwright.

**Data model (`db/migrations/`):**
- `workspaces(id, name, session_hash)` replaces `organizations`/`users`: a self-service demo tenant tied to an httpOnly cookie (only its hash is stored).
- `cases` → `workspace_id`; every admin query joins through `cases.workspace_id`, and documents and requests are reached only through it.
- `documents(kind original|signed, sha256, content bytea, …)`: originals and executed PDFs are separate immutable rows, so there is no object store.
- `signing_requests(status draft|pending|completed|revoked, token_hash unique, token_ciphertext, expires_at, signed_document_id, …)`; "expired" is derived from `expires_at` and enforced at submit.
- `signature_fields(kind signature|name|date, page_index, x, y, width, height)`: normalised 0–1 in displayed page space.
- `signing_events(event_type, actor admin|signer|system, occurred_at, ip_hash, user_agent, metadata)`: written server-side only.
- `upload_sessions` / `upload_chunks`: staging for chunked uploads.

**Routes:**
| Route | Who | Purpose |
|---|---|---|
| `/` | public | Landing; "Open demo workspace" (form POST → `/api/workspace`) |
| `/dashboard`, `/cases/[caseId]` | workspace cookie | Case list; case detail: upload → place fields → link → completed + audit log |
| `/sign#<token>` | signer | Client-rendered signing page; the token stays in the fragment |
| `POST /api/cases`, `POST /api/cases/[id]/document`, `POST /api/cases/[id]/uploads`, `PUT /api/uploads/[id]/chunks/[i]`, `POST /api/uploads/[id]/complete` | workspace | Create case; single or chunked upload |
| `GET /api/documents/[id]` | workspace | Stream original or signed PDF (scoped to the workspace) |
| `PUT /api/requests/[id]/fields`, `POST …/send`, `…/revoke`, `…/restart` | workspace | Field autosave; issue link (draft → pending); revoke; new request after revoke/expiry |
| `POST /api/sign/view`, `GET /api/sign/document`, `POST /api/sign/submit` | `x-signing-token` header | Signer view data; original (pending) / signed (completed) PDF; atomic signing |

**Signing transaction (`submitSignature`):** lock the request row → check `pending` and not expired → load fields → log consent → stamp the PDF in memory (fields + certificate page) → insert the signed document → `UPDATE … SET status='completed' WHERE status='pending'` → log `document_signed` and `request_completed` → commit. Any failure rolls back everything, so the signer can retry.

**Coordinate pipeline:** browser `clientToNorm(pointer, overlay.getBoundingClientRect())` → normalised rect stored → server `pageGeometry(page)` (CropBox ∩ MediaBox, normalised /Rotate) → `normRectToPdf` → image fitted ("contain") and drawn at the displayed bottom-left anchor with `rotate = /Rotate`.
