# CLAUDE.md — Astra Round 2 Signing Automation Sprint

## Mission and clock
Ship a **working, deployed, self-service agreement-signing workflow** for a company that opens one case/file per client. An evaluator will upload a previously unseen **MIND client agreement** and get it signed end-to-end. **Official deadline: Friday, 2026-11-20 at 01:21 AM EST (America/Detroit). No GitHub commits after this instant.** The official countdown on the challenge page overrides other clocks.

We are optimizing for: (1) unknown-PDF happy path works; (2) convincing, low-friction product experience; (3) documented decisions and verification. Do not optimize for feature count or AI novelty.

## Source of truth, in order
1. Challenge instructions pasted by the user; deadline and rules are immutable.
2. `docs/PRD.md` (requirements, acceptance criteria).
3. `docs/ARCHITECTURE.md` (data model, trust boundaries, states).
4. `docs/DELIVERY_PLAN.md` (priorities / gates).
5. Existing implementation and tests; record deviations in `docs/DECISIONS.md`.

## Required end-to-end demo
1. Evaluator opens a public HTTPS deployment and accesses a **demo workspace without contacting the developer**.
2. Creates a file/case with synthetic client name/email, uploads a never-before-seen **multi-page PDF**.
3. Visually places a **signature field** on any page; can reposition or correct it before sending. If possible, offer date/name fields, but signature is mandatory.
4. Creates a signing request, gets a **shareable public signer URL** (email delivery is helpful but NOT the only delivery route).
5. In a separate/incognito browser, signer views the exact PDF, consents to electronic signing, draws/types a signature, and submits once.
6. Admin dashboard shows `Completed`; evaluator views/downloads signed PDF with signature **embedded at the exact page coordinates**, including page transforms.
7. A server-generated event log records request creation, signing, and completion; completed requests cannot be signed again.

## Engineering rules
- Work in small vertical slices, not frontend/backend silos. After each slice, run its tests and confirm actual browser behavior.
- Before a material change, inspect existing files and summarize affected surfaces in the working notes. Do not bulldoze working code.
- Prioritize **P0 > P1**. If time is short, stop adding features and stabilize + submit.
- No placeholder buttons, fake success state, broken links, undocumented manual setup, or mocked completion in the evaluator flow.
- Use TypeScript strict mode, Zod boundary validation, explicit error states, safe migrations, and tested core utilities.
- Never place service-role keys or sensitive signing tokens in client code, logs, query analytics, repo, or screenshots. Store token hashes server-side; use unpredictable expiration-bound signing links. Handle token reuse and repeated submission safely.
- Use only test/synthetic people and documents. Do not upload real client agreements to third-party AI APIs. No AI is required.
- Make PDF field coordinates page-relative and correctly translate viewer coordinates to PDF coordinates (scale, scroll, page number, rotation). Add a regression test for a second-page field.
- Treat signed PDFs as immutable artifacts; record hashes and useful audit metadata. Do not claim legal certification, identity proof, or regulatory compliance that is not implemented.
- Every user-facing async action shows loading, success or actionable error. Ensure links work on mobile and desktop.
- Keep README and submission summary truthful. Distinguish implemented/verified from planned.

## Stack preference (not dogma)
Next.js App Router + TypeScript + Tailwind; PostgreSQL + storage (Supabase is acceptable); PDF.js/react-pdf for previews, pdf-lib for stamping; Resend optional for email; Vercel for HTTPS deployment; Playwright for critical browser flows. Reuse the chosen stack and avoid rewrites once the vertical slice works.

## Git process and deployment
- `main`: deployable, evaluator-tested source; protect it from speculative changes.
- `develop`: integration branch for short-lived development, if parallel work justifies it.
- `feat/<scope>`, `fix/<scope>`, `docs/<scope>`: short-lived changes; merge only after quality checks.
- With <48 hours left, **prefer a small number of sequential changes** over complicated worktree/branch orchestration. Do not force PR ceremony where it slows delivery.
- Commit frequently with meaningful messages. Verify `git status`, tests and deployment before final merge.
- Deploy a working vertical slice as early as possible. Validate the **production URL** (not only localhost) in a fresh browser.
- **Stop all commits/pushes before deadline**. Capture final commit SHA, deployed URL, and submitted response. Do not commit after deadline even to fix docs.

## Practical command workflow
1. Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DELIVERY_PLAN.md` and inspect repo.
2. Implement P0 first, in order: file upload → field placement → signing link → signing → signed PDF → admin status.
3. Run lint/typecheck/unit tests; run Playwright against local and deployed builds.
4. Document gaps honestly in `docs/DECISIONS.md` and `docs/SUBMISSION.md`.
5. Before ending each work unit, report: changes; tests; deployed verification; blockers; next highest-priority task.

## Definition of done
- A novice evaluator can complete all seven demo steps in a single session without credentials provided out-of-band.
- Tested with a newly generated multi-page PDF unknown to the app.
- No post-deadline commits; publicly accessible URL; repository public or collaborator `theastraway` invited.
- Submitted description includes included features, intentionally excluded features, tools/AI used, repo URL and URL to try.

## Autonomous execution expectations
Proceed without asking for trivial design choices. Use reasonable defaults and record them. Ask only when blocked by **real credentials, external authorization, billing, destructive operations, or material product ambiguity**. Do not claim that an unexecuted test or undeployed build works. Never submit externally on the user's behalf without explicit instruction.
