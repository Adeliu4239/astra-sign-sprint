<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Engineering rules for all agents (FileSign)
Project context, invariants and the full workflow are in `CLAUDE.md` and `docs/DEVELOPMENT.md`. If guidance conflicts, `CLAUDE.md` wins.

1. **Branches:** never commit or push to `main`. Work on one scoped `feat|fix|docs|test|chore/<purpose>` branch cut from an up-to-date `main`.
2. **Merges:** open a PR with summary, risk, rollback and real test results. Never merge, auto-merge or deploy without the owner's explicit approval. Squash merge only.
3. **Checks:** run `npm run typecheck && npm run lint && npm test && npm run build` before review. Add `npm run test:integration` for service or migration changes, and `npm run test:e2e` for critical-flow changes.
4. **History:** never force-push, rewrite history, `reset --hard` shared branches, or move tags.
5. **Scope:** keep changes scoped. No new features or broad refactors without approval.
6. **Data:** use synthetic data only. Never commit secrets, `.env*` (except `.env.example`), signer tokens or links, raw test output or generated PDFs.
7. **Never:** alter signed PDFs or completed requests, or write destructive migrations.
