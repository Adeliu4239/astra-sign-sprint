# Deadline-driven sprint plan

## Non-negotiable stop time
**2026-11-20 01:21 AM EST (America/Detroit).** Official challenge countdown is authority. Stop pushing commits **before** it. Reserve final review and submission buffer; avoid last-minute scope creep.

## Priority ordering
1. Unseen PDF can upload and preview.
2. Arbitrary page field placement works.
3. Unique public signing URL works.
4. Signer can consent and sign.
5. PDF receives actual embedded signature, persists and downloads.
6. Production URL works from fresh browser, evaluator can self-serve.
7. Audit and email/template polish if already green.

## Gates (relative, not promises)
**Gate A — Skeleton:** repo, env example, data migrations, public demo entry, case create; commit and deploy skeleton.
**Gate B — First vertical path:** upload unknown PDF → field placement → public URL → signing → executed PDF; inspect 2-page generated test PDF; merge to main and deploy.
**Gate C — Reliability:** correct states; replay/expired links; authorization; upload errors; persistent files; tests.
**Gate D — Polish & submission:** UX, optional email/templates, docs, production E2E video/screenshots if helpful; capture SHA and URLs; submit with buffer.

## Scope-cut rules
- If signer flow not working: stop styling, AI and multi-tenant extras.
- If PDF page 2 wrong: fix coordinates before any new feature.
- If email setup blocks: copy-link is sufficient P0; leave email optional.
- If auth/onboarding blocks evaluator: build a safe, test-only demo entry with a clear disclaimer; do not weaken private production data access.
- If deployment fails: prioritize live end-to-end path over optional features.

## Daily status format for Claude
`Current branch/SHA | Deployed URL | P0 passing/blocked | Tests (actual commands/results) | Next 1-3 actions | Deadline risk`

## Completion lock checklist
- [ ] Current production deploy exactly matches last tested commit SHA.
- [ ] Fresh-browser production smoke test, synthetic unknown multi-page PDF.
- [ ] Repo public OR `theastraway` collaborator invited.
- [ ] No secrets/real PII in repo, logs, test artifacts.
- [ ] README + submission description truthful and current.
- [ ] Final GitHub commit timestamp strictly before deadline.
- [ ] Submission saved with valid repo and deployed links before deadline.
