# Product requirements — FileSign (working name)

## The job to be done
Each company creates a case ('file') for a client, must obtain a signed standard agreement before work begins, and needs a reliable way to send, track, complete and archive that agreement. Astra AI is the first customer. Anthony will test with an unseen MIND agreement; the format/content cannot be hard-coded.

## Persona and journey
- **Office/admin** creates case, attaches arbitrary PDF, places required signature field, sends or copies URL, checks state and retrieves executed PDF.
- **External signer** opens unique URL without registering, reviews PDF, affirmatively consents to e-sign, signs and downloads a copy (optional), sees a final confirmation.
- **Evaluator** must be able to assume both personas with synthetic data, ideally by copying link into an incognito tab.

## Priority / acceptance criteria
### P0 — necessary to pass
- [ ] Public HTTPS app and frictionless accessible test workspace (demo entry point or clearly displayed demo credentials).
- [ ] Create case with client display name and test email, list/open case.
- [ ] Upload an arbitrary PDF (document not supplied during development), safely validate extension/MIME/file signature/size; handle multi-page.
- [ ] Preview PDF and manually place at least one **required signature** field on any page with visible confirmation. User can correct placement.
- [ ] Create unique signing request; show public signer URL with copy button; admin can revisit it while pending.
- [ ] External signer views all pages, accepts consent and signs using type or draw, then submits.
- [ ] Server stamps signature into PDF using correct PDF page and coordinates; stores original and executed version separately.
- [ ] Completed state is stored durably, visible to admin, signed PDF accessible/downloadable; signing link cannot perform another sign.
- [ ] Refresh/navigation/server restart do not erase request or file.
- [ ] One end-to-end local and one end-to-end **production** test using new synthetic multi-page PDF.

### P1 — only after P0 green
- [ ] Send request by email (with copy-link fallback).
- [ ] Reusable template/reference PDF for recurring agreements.
- [ ] Audit timeline + SHA-256 file hash + completion timestamp in UTC.
- [ ] Basic admin login and tenant scoping (or clearly constrained demo workspace).
- [ ] Resend/revoke/expire signing request and meaningful empty/error states.
- [ ] Signer printable/downloadable copy and admin email confirmation.

### P2 — intentionally defer
- [ ] AI detection of signature fields; multi-party signing order; payment plans; CRM integrations; complex automation builder; advanced analytics; bulk actions; brand customization; full compliance certifications; identity verification; native mobile apps.

## Critical edge cases
- PDF 1 page vs >1 page, portrait/landscape, pages with distinct dimensions, zoom and scroll.
- Signature field on page 2, not merely page 1.
- Uploaded PDF with existing form fields, embedded fonts, or non-selectable scanned pages (still viewable/signable).
- Invalid/corrupt/oversized PDF fails with helpful error, without breaking case state.
- Back/refresh while signing; double-click submission; expired/revoked/missing link.
- Same URL attempted twice after completion; direct access to another tenant's case/PDF denied.
- Signing flow works when email provider is unconfigured (link can still be copied).

## Out-of-scope legal claims
This is an evaluated prototype using synthetic data. It can record consent/signature artifacts but MUST NOT claim guaranteed legal enforceability, identity verification, or ESIGN/UETA/eIDAS compliance merely because it stores a signature image. Document security and validation limits.

## Product success criterion
An independent reviewer signs an unfamiliar multi-page MIND PDF start-to-finish, without assistance or needing code changes, and can inspect the correctly signed downloadable PDF.
