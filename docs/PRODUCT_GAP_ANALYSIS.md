# Product gap analysis and reusable templates design

Written 2026-11-18 on `feat/reusable-agreement-templates`, branched from `main` `47cc23c`. "Verified" means it was checked against code, tests or the production QA in `docs/FINAL_QA.md`.

## 1. Current capabilities (verified)

| Area | State | Evidence |
|---|---|---|
| First-time admin | Self-service demo workspace, no sign-up; case → upload → place → link in about a minute | FINAL_QA Phase 1 |
| Unknown PDF intake | Any PDF ≤ 25 MB / ≤ 300 pages. Chunked upload; corrupt and password-required files rejected; owner-protected PDFs decrypted | FINAL_QA ADV-01…06, unit `decrypt.test.ts` |
| Field placement | Signature (required), name and date on any page; move, resize, keyboard nudge, autosave; rotation and CropBox aware | unit `coordinates.test.ts`, `stamp.test.ts`; E2E gold path |
| Signer | Desktop and phone; draw or type; explicit consent; single submit under concurrency | FINAL_QA ADV-12…17 |
| Signed PDF | Stamped at exact coordinates, plus a certificate page; stored separately and immutable | E2E content-stream check; FINAL_QA renders |
| Audit | Server-side events in UTC; rejected attempts logged; original and signed SHA-256 | E2E gold path |
| Isolation | Every admin query scoped by workspace; foreign IDs → 404, no session → 401 | E2E tenant test; FINAL_QA ADV-24…29 |

## 2. Missing client outcomes

The client says: *"Every client … has to sign **the same agreement** … automate getting that agreement signed **on every file** … sell it to every other company in our industry."*

| # | Gap | Sev | User impact | Effort | Regression risk |
|---|---|---|---|---|---|
| G-1 | **No reusable agreement.** Every case re-uploads the same PDF and re-places the same fields, so the "same agreement on every file" job is still manual. | **P1** (P0 for the client's stated outcome, not for the evaluator demo) | About 1–2 min of repeated work per file, and placement drifts between files | ~4 h | Medium: touches case creation. Mitigated by keeping the direct-upload path unchanged and fully re-tested |
| G-2 | Non-WinAnsi names print as `?` in name field and certificate (FINAL_QA Q-1) | P1 | Lossy evidence for non-Latin names | 1–2 h (Latin-Ext), more for CJK | Medium: stamping |
| G-3 | No server email delivery | P2 | Admin pastes the link themselves | Provider and deliverability work | Low, but needs credentials |
| G-4 | No rate limiting or storage quota per workspace | P2 | Abuse and cost risk on a public demo | 0.5–1 h | Low |
| G-5 | Workspace = browser cookie; no accounts or teams | P2 for demo, P1 for "sell to other companies" | Cannot share a workspace across staff | Days (auth) | High; excluded |
| G-6 | No signer reminders or bulk send | P2 | — | — | Excluded |

**Remaining manual work per case today:** create the case (3 inputs), upload the PDF, place 1–3 fields, create the link, copy it.
**With templates:** create the case (3 inputs + pick a template), create the link, copy it.

**Multi-company expansion:** the data model is already tenant-scoped (`workspace_id` on every root row), so templates per workspace fit the "sell to other companies" path. Real tenants would need accounts (G-5). That is out of scope before the deadline.

## 3. Reusable templates: design (minimal and robust)

**Approach: maximum reuse.** A template is stored as a `cases` row with `kind = 'template'`. Its PDF is a normal `documents` row, and its field layout lives on a draft `signing_requests` row that can never be sent. This means:
- upload (single and chunked), PDF validation, decryption, the viewer, the field editor with autosave, and coordinate logic are reused **unchanged** through the existing routes;
- workspace isolation comes for free, because every existing admin query already joins `cases.workspace_id`.

**Snapshot on use.** "New case from template" runs in **one transaction**. It locks the template's draft request, then copies:
- the template PDF bytes into a **new** `documents` row for the new case (same SHA-256);
- the fields into a **new** draft request.

The case keeps only a nullable `template_id` (`on delete set null`) for display. After that the case shares no mutable rows with the template, so:
- editing template fields, replacing the template PDF or deleting the template cannot change existing cases, pending links or signed artifacts;
- two cases from one template are fully independent.

**Guards:**
- Template requests can't be sent, revoked or restarted (409).
- Template rows never appear in the case list or counts, and `/cases/<template id>` returns 404.
- A template can be used only once it has a PDF and at least one signature field.
- A foreign or deleted template ID gives 404.

**Migration `003_templates.sql` (additive, backward compatible):**
- `cases.kind text not null default 'client' check (kind in ('client','template'))`
- `cases.template_id uuid null references cases(id) on delete set null`
- index `(workspace_id, kind, created_at desc)`

Old code (production `47cc23c`) keeps working on the migrated schema, since all existing rows default to `client`.

**UI:**
- `/templates`: list and create (name).
- `/templates/[id]`: upload or replace the PDF, the same field editor in "template" mode (no link section), and delete.
- Dashboard new-case form: an optional "Agreement" select ("Upload a PDF after creating" by default, or a saved template).
- Case page: shows "Prepared from template …".
- Events: `template_created` on the template; `document_from_template` on the case (filename, pages, SHA-256, template name and ID, field count), which also appears on the certificate.

**Excluded on purpose:**
- template versioning UI (the snapshot makes it unnecessary for correctness);
- template sharing across workspaces;
- auto-sending on case creation (the admin still reviews and clicks "Create signing link");
- AI field detection.

## 4. Acceptance criteria (templates)
1. An admin can create a template, upload an arbitrary multi-page PDF, place signature/name/date fields, and see them persist after refresh.
2. The new-case form lists the workspace's usable templates. Creating a case from one lands on the case page with the PDF and fields already placed and status Draft.
3. Two cases from the same template have different document and request IDs. Both can be signed independently, and each signed PDF has the signature inside the template's rectangle on the right page.
4. After a case is created, moving or deleting template fields, replacing the template PDF, or deleting the template leaves that case's fields, document and status unchanged, and it can still be signed.
5. Another workspace gets 404 for the template page, its PDF, its field API, and when creating a case with that template ID.
6. A template can't be sent (409) and doesn't appear in the case list.
7. The existing direct-upload E2E suite stays green.

## 5. Implementation order
1. Migration + service functions + schema changes.
2. API routes (`/api/templates`, `/api/templates/[id]`) and the `templateId` field on `/api/cases`.
3. Pages and components (templates list and editor, FieldEditor template mode, NewCaseForm select, header link).
4. DB integration tests (Vitest against local Postgres) for snapshot independence, guards and isolation.
5. Playwright `templates.spec.ts`: template → 2 cases → sign both → verify artifacts → edit and delete template → cases unaffected → cross-workspace denial.
6. Full regression: typecheck, lint, unit, build, local E2E (all specs).

## 6. Preview deployment decision
The Vercel **Preview environment uses the same `DATABASE_URL` as Production**, and `vercel-build` runs migrations. A Preview deploy would therefore apply `003_templates.sql` to the **production** database before review. The migration is additive and old code tolerates it, but the user's instruction was to deploy a Preview only if it is isolated from production DB changes, so **no Preview is deployed**. Verification runs on a local production build (`next build && next start`) against local Postgres. Isolating a Preview would need a Neon branch plus a Preview-only `DATABASE_URL`; that's an infrastructure change for the owner to approve.
