# Git workflow for a short production sprint

## Branch policy
- `main`: working, deployable branch; should always pass P0 smoke test.
- `develop`: integration branch **only if** multiple independent workstreams truly need it. Otherwise feature → main minimizes overhead.
- `feat/pdf-upload`, `feat/signing-flow`, `feat/audit`, `fix/pdf-coordinates`, `docs/submission`: short-lived branches with clean scope.
- Avoid long-lived speculative branches and automatic destructive cleanup of worktrees.

## Commands (new repo)
```bash
git init -b main
git add . && git commit -m "chore: initialize signing sprint docs"
git switch -c feat/vertical-slice
# make changes; run checks
git add -A && git commit -m "feat: add end-to-end signing vertical slice"
git switch main
git merge --no-ff feat/vertical-slice
# only after smoke test:
git push -u origin main
```
If an existing repo exists, **inspect it before init/overwrite**. Use PRs only when worthwhile. Feature branches should not remain unmerged at deadline.

## Commit naming
`feat:`, `fix:`, `test:`, `docs:`, `chore:` + meaningful summary. Commit after a working slice, not only when every feature is done. Check `git diff --check`, lint/typecheck/tests before merging.

## Deployment
Connect Vercel production to `main`. Preview deployments for branches are useful, but grade against **production**. Record live URL and deployment SHA. Test file persistence on real hosted DB/storage, not an in-memory local store.

## Deadline discipline
Stop risky merges well before 01:21 AM EST on Nov 20. No commits or pushes after official cutoff. If submission fails, address it **before** cutoff; do not assume a last-second commit will count.
