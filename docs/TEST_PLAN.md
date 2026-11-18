# Test plan and evaluator rehearsal

## Gold-path production E2E (manual + automate with Playwright)
1. Visit public URL in clean/incognito browser; enter self-service demo workspace.
2. Create synthetic case: `MIND Test Case 001` / `Taylor Example` / `taylor@example.com`.
3. Upload **newly generated** 2- or 3-page PDF with different page layouts; do not rely on a bundled fixture as the only successful PDF.
4. Place signature field on **page 2**, away from page corners; verify visual placement survives refresh.
5. Create signing request, copy URL and open incognito. Ensure every PDF page is visible.
6. Accept explicit consent, type/draw signature, submit; observe confirmation.
7. Return to admin; status completed; download signed PDF; visually inspect **page 2** at correct field location, original content preserved.
8. Refresh dashboard; verify persistent state. Retry same signing link → no duplicate signing.

## Additional high-value checks
- Invalid PDF, unsupported file, oversize input produce clear errors.
- Different aspect ratio, page count, zoom level and rotated pages don't misplace the signature.
- Single-click vs double-click submit, redirect + browser refresh, request expiry.
- Unauthorized admin case access returns denial; signer link doesn't expose admin records.
- Browser console and network tabs have no uncaught errors / 500s.
- Email failure does not prevent copying link; backend never fabricates send success.

## Automated quality gates
- Typecheck `tsc --noEmit` (or equivalent).
- Lint (`npm run lint`).
- Unit test PDF coordinate transforms and request state transitions.
- Playwright E2E at least one local and one production run; avoid putting secret tokens in recorded artifacts.
- Test DB migration on empty environment; test private storage path authorization.

## Evidence checklist
Capture verified deployed URL, git SHA, test results and remaining limitations in `docs/SUBMISSION.md`. Avoid claims of compliance or identity authentication not actually demonstrated.
