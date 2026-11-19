# Decision log and scope rationale

Dates in Detroit time. "Status" reflects what is in the deployed build.

## Product decisions

| Decision | Why | Consequence / mitigation | Status |
|---|---|---|---|
| Support arbitrary uploaded PDFs, not a prebuilt MIND template | Reviewer supplies an unseen agreement | Admin places fields manually before issuing the request | Implemented |
| One signer per case | Matches the "one file per client" workflow | Multi-signer routing postponed | Implemented |
| Copy-link delivery; "Email via my mail app" (`mailto:`) instead of an email provider | Email credentials/deliverability can fail; the challenge requires link delivery, email optional | No server-sent email, so the app never claims a send happened. P1 if time allowed | Implemented (no provider email) |
| Manual field placement (signature required; full name and date optional) | Works on any layout; AI detection is unreliable on unseen documents | Admin clicks to place, drags to move, corner-drags to resize | Implemented |
| Typed or drawn signature + explicit consent checkbox | Better usability and evidence than uploading an image | Not proof of identity or legal compliance (stated in the UI and on the certificate) | Implemented |
| Signing certificate page appended to the signed PDF | Gives the downloaded artifact its own evidence: signer, consent text, UTC events, original SHA-256, hashed IP | Original pages stay unchanged except for the stamped fields | Implemented |
| **Reusable agreement templates** stored as `cases` rows with `kind='template'`, reusing the upload, viewer, field editor and draft-request tables | The client's job is "the same agreement on every file". Maximum reuse keeps the signing engine untouched and isolation automatic (every admin query is already workspace-scoped) | A template can never be sent (409) and never appears as a case. Using one **copies** the PDF bytes and fields into new rows in one transaction, so template edits or deletion never affect existing cases or issued links. `cases.template_id` is `on delete set null` and used for display only. Additive migration `003_templates.sql` | On feature branch (2026-11-18), not yet in production |
| Self-service **demo workspace per browser** instead of accounts | The evaluator must get in without contacting us; avoids shared demo credentials | Workspace is tied to an httpOnly cookie. Clearing cookies or switching browsers loses access to that workspace (data stays in the DB) | Implemented |

## Technical decisions

| Decision | Why | Consequence / mitigation | Status |
|---|---|---|---|
| Next.js 16 App Router, `cacheComponents` **disabled**, `force-dynamic` on DB pages | Fewer framework surprises under deadline; every page reads live state | No partial prerendering; fine for this app | Implemented |
| PostgreSQL (Neon via Vercel Marketplace) with PDFs stored as `bytea` | One private store; the signed artifact, status change and audit events commit in **one transaction**, so there is no "completed but missing file" state | DB size grows with files (fine for a prototype). An object store would be the scale-up path | Implemented |
| DB constraint `completed ⇒ signed_document_id and completed_at` | Defence in depth against an inconsistent completion | — | Implemented |
| Signing is serialized with `SELECT … FOR UPDATE` on the request row + `status = 'pending'` compare-and-set | Double clicks, duplicate tabs and replays can't sign twice | A second submit waits, then gets 409 "already signed". Rejected attempts are logged | Implemented, E2E-tested |
| Field coordinates stored **normalised (0–1) in the displayed page space** (rotation applied, top-left origin); converted to PDF points on the server (`src/lib/pdf/coordinates.ts`) | Independent of zoom, CSS size, devicePixelRatio and scroll; the server handles CropBox offsets and /Rotate 90/180/270 | Signature images are drawn rotated so they read upright on rotated pages. Unit tests cover all rotations and a page-2 regression | Implemented |
| Original content wrapped in `q … Q` before stamping | Some PDFs leave an unbalanced transform that would shift new drawings | Unit-tested with a deliberately unbalanced `cm` | Implemented |
| Signer token: 256-bit random, only **SHA-256 hash** used for lookup, AES-256-GCM copy kept so the admin can re-copy a pending link; cleared on completion/revoke; 14-day expiry | Meets "store token hashes server-side" while still letting the admin revisit the link | `APP_SECRET` encrypts at rest; losing it only hides pending links (revoke + restart issues a new one) | Implemented |
| Signer link uses the **URL fragment** (`/sign#<token>`); the client sends the token only in the `x-signing-token` header | Fragments are never sent to servers or in `Referer`, so tokens stay out of platform access logs and analytics | The signer page renders on the client. `Referrer-Policy: no-referrer` is set globally | Implemented |
| Chunked upload (3 MB parts staged in Postgres) for files > 3 MB; limit 25 MB | Vercel caps function request bodies at ~4.5 MB | Parts are reassembled and go through the same validation. Abandoned sessions are purged after 1 day | Implemented, E2E-tested with 9 MB |
| PDF responses are **streamed** | Measured on this project: buffered responses over ~4.5 MB fail on Vercel, streamed 8–20 MB responses succeed | — | Implemented |
| Owner-password ("restrictions only") PDFs are decrypted server-side with `@cantoo/pdf-lib`; PDFs that need a password to open are rejected with instructions | Protected business PDFs are common; pdf-lib can't write to encrypted files | The decrypted copy becomes the case original. The audit event records both the uploaded and stored SHA-256 | Implemented, unit-tested |
| PDF.js legacy build + bundled standard fonts, CMaps, wasm decoders, ICC profiles | Wider browser support (older Safari) and faithful rendering of non-embedded fonts, CJK and scanned JPX/JBIG2 pages | ~4 MB of static assets in `public/pdfjs` (copied by `postinstall`) | Implemented |
| Upload validation: extension or MIME type, `%PDF-` magic in the first 1 KB, full parse of every page, ≤ 300 pages, ≤ 25 MB | Unknown input | Clear 4xx messages are shown in the UI | Implemented |
| Name/date text uses standard Helvetica (WinAnsi) | No font embedding needed | Characters outside WinAnsi (e.g. CJK) print as `?` in name fields. The **signature image** is unaffected | Known limitation |

## Deliberately excluded
- **AI contract analysis / auto-placement**: unreliable on unseen layouts and unnecessary for the core flow. We don't send documents to third-party AI.
- **Payments, CRM/Zapier, workflow builder**: integration risk with no evaluation value.
- **Multi-party routing, witnesses, notary**: not required.
- **Identity verification, qualified signatures, regulatory certification**: can't honestly be established in a prototype. No compliance claims are made.
- **Accounts / team management**: replaced by isolated self-service demo workspaces.
- **Server-sent email (Resend)**: optional. Link copy and `mailto:` cover delivery without fake success states.
- **Rate limiting**: not implemented. Tokens are 256-bit (not guessable) and signing is single-use, but workspace creation and uploads are not throttled. This is the next security item for a real deployment.

## Open questions resolved by defaults
- File = case for exactly one client; one active signing request per case (revoke + "start a new request" re-issues).
- Unknown agreement format = standard PDF (Word files are not converted).
- Signer = one invited person; test data only.
- No special account registration; a clearly labelled demo entry point, with each workspace isolated from the others.
