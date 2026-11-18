<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Repository rules for all agents (FileSign)
These are binding. Details: `CLAUDE.md` § Git process and `docs/GIT_WORKFLOW.md`.
1. Never commit or push to `main`. Work on one scoped `feat|fix|docs|test|chore/<purpose>` branch cut from an up-to-date `main`.
2. Open a PR with summary, risk, rollback and real test evidence. Do not merge, auto-merge or deploy without the user's explicit approval. Merge by squash only.
3. Before requesting review run `npm run typecheck && npm run lint && npm test && npm run build`. Critical-flow changes also need `npm run test:e2e`.
4. Never force-push, rewrite history, `reset --hard` shared branches, or move tags (`round2-validated` is frozen).
5. Production deploys only from clean `main` after approval. Then confirm the deployment's `githubCommitSha` equals HEAD and run the production E2E suite.
6. No new features without explicit approval. Synthetic data only. Never commit secrets, `.env*` (except `.env.example`), signer tokens or links, or raw test output. Never alter stored signed PDFs or completed requests.
7. Hard cutoff: nothing is committed, pushed, merged or deployed at or after 2026-11-20 01:21 AM EST.
