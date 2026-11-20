# Design decisions

Each decision lists the context, the choice, and its consequences. The implementation is described in [ARCHITECTURE.md](ARCHITECTURE.md).

## Product scope

**The job.** A company opens one case per client and needs the same agreement signed before work begins. The office must be able to send it, track it, complete it and archive it without a developer. A reviewer must be able to do all of this with a PDF FileSign has never seen.

### Arbitrary PDF upload
- **Why:** agreements arrive as whatever PDF the company already has. A built-in form or fixed layout would fail on the first unfamiliar document.
- **Choice:** accept any standard PDF up to 25 MB and 300 pages, and validate it strictly. Decrypt owner-protected files, and handle rotated pages and offset crop boxes.
- **Consequences:**
  - Word files are not converted.
  - PDFs that need a password to open are rejected with instructions.
  - Large files need chunked upload and streamed responses, because of the platform's 4.5 MB body limit.

### Manual field placement
- **Why:** automatic detection (heuristics or AI) is unreliable on unseen layouts, and a misplaced signature is worse than a few seconds of clicking. Sending real agreements to a third-party AI service is also a data-handling risk.
- **Choice:** the admin clicks to place a signature field (required) and optional name and date fields, then drags to adjust. Coordinates are normalized to the displayed page and converted once, on the server.
- **Consequences:** placement is explicit and works on every layout. Templates remove the repeated work for standard agreements.

### Templates as independent snapshots
- **Why:** the client's real workload is the same agreement on every file. Cases must stay stable, though: a link already sent must not change because someone edited the template.
- **Choice:** a template is a `cases` row with `kind = 'template'`, so it reuses the existing upload, editor and scoping paths. Using one copies the PDF bytes and fields into new rows in one transaction. The case keeps a nullable `template_id` for display only.
- **Consequences:**
  - Template edits, PDF replacement and deletion never affect existing cases, pending links or signed artifacts.
  - Each use duplicates the PDF bytes, so the copies count against the workspace quota.
  - No versioning UI is needed for correctness.
  - Templates can't be sent and never appear as cases.

### Self-service demo workspaces instead of accounts
- **Why:** a reviewer must get in without contacting anyone, and shared demo credentials would mix everyone's data.
- **Choice:** "Open demo workspace" creates an isolated tenant tied to a random httpOnly cookie. Only the cookie's hash is stored, and every admin query is scoped to the workspace.
- **Consequences:**
  - There is no login, team sharing or cross-device access to a workspace; clearing cookies opens a new, empty one.
  - Signing links work anywhere.
  - The schema is already tenant-scoped, so real accounts can map onto workspaces later.

### Single-use, expiring links
- **Why:** the link is the signer's only credential. It must be unguessable, useless after signing and kept out of logs.
- **Choice:**
  - a 256-bit random token, looked up by its SHA-256 hash;
  - expiry after 14 days;
  - completion closes it, and revoke or restart replaces it;
  - the token travels in the URL fragment and an HTTP header, never in a query string;
  - an encrypted copy lets the admin re-copy a pending link, and it is cleared when the request closes.
- **Consequences:**
  - The signer page must render on the client.
  - Losing `APP_SECRET` only hides pending links, which can be revoked and reissued.
  - Expiry is detected when the link is used, so no separate "expired" event is written until then.

### One signer per case
- **Why:** this matches one client per file.
- **Consequence:** multi-party routing, signing order and witnesses are not supported.

### Hashes, certificate page and audit trail
- **Why:** a signed PDF should carry its own evidence, and the record must be trustworthy even when the browser is not.
- **Choice:**
  - Originals and signed PDFs are separate, immutable rows, each with a SHA-256.
  - Events are written only by the server, with UTC times and a keyed IP hash.
  - A certificate page lists the signer, the consent text, events, the original hash and the hashed IP.
  - The signed artifact, the status change and the events commit in one transaction.
- **Consequences:** there is no "completed without a file" state, and the evidence survives export. The hashes prove integrity, not identity, and they are not a cryptographic PDF signature.

### Typed or drawn signature with explicit consent
- **Why:** both are familiar and work on phones. An explicit consent step records intent.
- **Consequence:** the email address is shown as "provided by sender, not verified". Nothing proves who signed.

## Technical choices

| Decision | Rationale | Consequence |
|---|---|---|
| PDFs stored in Postgres (`bytea`) instead of an object store | One private store lets the artifact, status and events commit atomically | Database size grows with files. Fine at prototype scale; an object store is the scale-up path |
| Row lock plus compare-and-set on signing | Double clicks, duplicate tabs and replays can't sign twice | A second submit waits, then gets a 409 and is logged |
| Normalized display-space coordinates with one conversion module | Independent of zoom, DPI and scroll; the server handles CropBox and `/Rotate` | Every rotation and the page-2 case are unit-tested |
| Wrap existing page content in `q … Q` before stamping | Some PDFs leave unbalanced transforms that would shift new drawings | Unit-tested with a deliberately unbalanced `cm` |
| Helvetica for WinAnsi text, otherwise OFL Noto fonts subset with HarfBuzz | Non-Latin names must print as typed without growing every PDF by megabytes; pdf-lib's own subsetter drops glyphs from these fonts | Adds a few KB per signed PDF. Unsupported scripts print `?` |
| PDF.js legacy build with bundled fonts, CMaps and wasm decoders | Older Safari support, and faithful rendering of CJK, non-embedded fonts and scanned images | About 4 MB of static assets, copied on install |
| Postgres-backed rate limits and quotas | Serverless instances share no memory | Fixed windows can allow up to twice the limit at a boundary; a shared NAT counts as one IP |
| Strict CSP without `unsafe-eval`; Zod in jitless mode | Limits the impact of any injected content | Inline scripts stay allowed because the App Router has no nonce pipeline |
| Additive migrations run during the build | Repeatable deploys, and rollback never needs schema changes | Preview deploys would migrate the production database, so they are not used |
| Dynamic rendering for all database-backed pages | Every page shows live state | No partial prerendering; acceptable for this app |

## Deliberately deferred

| Feature | Why deferred |
|---|---|
| Server-sent email | No verified sending domain was available to test deliverability safely. Copy link and the user's own mail app work reliably, and the app never claims an email was sent. |
| Full accounts, teams and roles | Days of authentication work with no benefit for a self-service evaluation. Demo workspaces give the same isolation. |
| Billing and plans | No paying users yet, and it adds integration risk with no product value today. |
| AI document parsing and field detection | Unreliable on unseen layouts, and real agreements should not be sent to third parties. |
| Multi-signer routing, CRM and workflow integrations | Outside the one-client, one-agreement job. |
| Identity verification and qualified signatures | Can't honestly be provided by a prototype, and they are not claimed. |

## Security and compliance limitations
- FileSign makes **no claim** of legal enforceability, identity verification, or ESIGN, UETA or eIDAS compliance.
- The signer's email address is not verified. Possession of the link is the only signer authentication.
- The demo workspace cookie is the only admin credential, and anyone with the browser profile has access.
- Signing endpoints aren't rate-limited; the token's entropy is the protection.
- Platform-level DDoS protection is left to Vercel.
- The certificate page is always US Letter.
- Text in unsupported scripts prints as `?`.
- Non-ASCII file names are stored with `_`.

## Commercialization roadmap
1. **Accounts and teams:** real sign-in mapped onto workspaces, with roles and invitations.
2. **Email delivery:** a verified sending domain, reminders, delivery status and a completion notice to the sender.
3. **Stronger signer assurance:** email one-time codes before signing, and optional identity verification through a provider.
4. **Cryptographic PDF signatures:** a PAdES signature with a timestamp over the stamped document, alongside the existing hashes.
5. **Storage at scale:** move PDF bytes to a private object store with retention policies, keeping hashes and metadata in Postgres.
6. **Template versioning and bulk send:** send one template to many clients and track the versions used.
7. **Multi-signer workflows:** signing order, countersignature and witnesses.
8. **Billing:** usage-based plans per workspace.
9. **Integrations:** CRM and practice-management systems, using webhooks on completion.
