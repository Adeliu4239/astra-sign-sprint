# Development workflow: branches, PRs, release, rollback

This applies from 2026-11-18 onward and replaces the earlier sprint notes. `CLAUDE.md` and `AGENTS.md` carry the short, binding version.

## Baseline
- **`round2-validated`** is an annotated tag on `72798b4`. At that commit, production deployment `dpl_J2zcR8zxxyasXmw58XKMS3oKekF8` was live; typecheck, lint, 33 unit tests and build passed; production E2E passed 7/7. **Never move or delete this tag.**
- `main` is the production branch. Vercel does **not** auto-deploy from Git; every production deploy is a deliberate CLI action (see *Release*).

## Branches
- Start every task from an up-to-date `main`:
  ```bash
  git switch main && git pull --ff-only origin main
  git switch -c fix/<short-purpose>   # or feat/ docs/ test/ chore/
  ```
- One scoped task per branch, with small Conventional Commits (`fix: …`, `test: …`). Keep unrelated edits out.
- Never commit to `main`, never force-push, never `reset --hard` a pushed branch, never rewrite published history.

## Pull requests
```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run test:e2e                       # required if the critical flow is touched
git push -u origin <branch>
gh pr create --base main --fill        # then complete the template
```
- The PR description follows `.github/pull_request_template.md`: what and why, risk, rollback, and the **commands actually run with their real results**.
- **The user approves every merge.** There is no auto-merge. Merge by squash: `gh pr merge <n> --squash --delete-branch`.
- Feature work (anything users can see that isn't a fix) needs explicit approval *before* implementation.

## Release (after an approved merge)
```bash
git switch main && git pull --ff-only origin main && git status --porcelain   # must be empty
vercel deploy --prod --yes
vercel inspect astra-sign-sprint.vercel.app                                   # note the deployment id
vercel api /v13/deployments/<id> | jq -r .meta.githubCommitSha                # must equal: git rev-parse HEAD
E2E_BASE_URL=https://astra-sign-sprint.vercel.app npm run test:e2e
```
Report the deployment id, SHA and E2E result in the PR thread. Docs-only merges still need a redeploy so the deployed SHA equals `main` HEAD. They still need the smoke E2E, but not a full cross-browser run.

## Rollback
1. **Production first:** `vercel rollback` (previous production) or `vercel promote <known-good-deployment-url>`. The baseline deployment is `dpl_J2zcR8zxxyasXmw58XKMS3oKekF8` (`round2-validated`). Rerun the production E2E.
2. **Then code:** open `revert/<purpose>` with `git revert <sha>`, then PR → approval → squash merge → redeploy. Never reset `main`.
3. Database migrations are additive only. A rollback never drops tables or deletes signed artifacts.

## Data and artifact hygiene
- Synthetic people and documents only.
- Do not commit any of the following:
  - `.env*` (except the placeholder `.env.example`)
  - `.vercel/`
  - signer tokens or links, or screenshots showing them
  - raw test output (`test-results/`, `playwright-report/`, `qa/artifacts/`)
  - generated PDFs
- Commit reproducible QA scripts (`qa/*.mts`). Commit sanitized screenshots only when a doc references them (`docs/qa/`).
- Stored signed PDFs and completed requests are immutable. No manual production DB edits.

## Deadline
Stop feature work early enough to verify production. **Nothing is merged, committed, pushed or deployed at or after 2026-11-20 01:21 AM EST.** The submission SHA is `main` HEAD as deployed. Confirm it with `githubCommitSha` before submitting.
