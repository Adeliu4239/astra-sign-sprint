## What changed and why
<!-- One scoped task. Link the related issue, if any. Branch: feat|fix|docs|test|chore/<purpose> -->

## Risk and rollback
- Risk to the critical flow (upload → fields → link → sign → signed PDF → status): none / low / medium / high, and why
- DB migration: none / additive (describe)
- Rollback: `vercel promote <previous deployment>` + `git revert <sha>` via PR

## Checks actually run (paste real results)
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`: __ / __
- [ ] `npm run build`
- [ ] `npm run test:e2e` (required if the critical flow is touched): __ / __

## Hygiene
- [ ] No secrets, `.env*` (except `.env.example`), signer tokens or links, real personal data, raw test output or generated PDFs
- [ ] No new feature beyond what was approved

## After merge (only once the user approves)
- [ ] Squash merged by/with approval of the user
- [ ] `vercel deploy --prod --yes` from clean `main`; deployment `githubCommitSha` == `main` HEAD
- [ ] `E2E_BASE_URL=https://astra-sign-sprint.vercel.app npm run test:e2e`: __ / __

## Deadline guard
- [ ] Merged and deployed strictly before 2026-11-20 01:21 AM EST
