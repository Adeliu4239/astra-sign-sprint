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

---

## Results (2026-11-18, code SHA `0cdff55`)

| Check | Command | Local | Production |
|---|---|---|---|
| Typecheck | `npm run typecheck` | pass | — |
| Lint | `npm run lint` | pass | — |
| Unit (coordinates incl. all rotations and CropBox; stamping incl. **page-2 regression**, unbalanced CTM, rotated page, text fields; state machine; decryption) | `npm test` | 33/33 | — |
| Build | `npm run build` | pass | Vercel build pass (runs migrations first) |
| E2E: gold path (fresh 3-page mixed-size + rotated PDF, signature on page 2, refresh persistence, separate browser signing, double-click, signed PDF content-stream check, replay 409, event log) | `npm run test:e2e` | pass | pass |
| E2E: non-PDF upload rejected with message | ″ | pass | pass |
| E2E: invalid / incomplete signer link messages | ″ | pass | pass |
| E2E: 9 MB PDF via chunked upload, streamed signed download | ″ | pass | pass |
| E2E: phone viewport (Pixel 7 emulation) typed signature | ″ | pass | pass |
| E2E: revoke → link blocked (409) → restart with same fields → new link | ″ | pass | pass |
| E2E: other workspace gets 404 for case and PDF; no session gets 401 | ″ | pass | pass |

Production runs use `E2E_BASE_URL=https://astra-sign-sprint.vercel.app npm run test:e2e`. Cross-engine run: `E2E_BROWSERS=chromium,webkit,firefox E2E_BASE_URL=https://astra-sign-sprint.vercel.app npm run test:e2e` → **21/21 pass** (2026-11-18 18:48 UTC), locally WebKit + Firefox 14/14. Traces, videos and screenshots are disabled so signer tokens never land in test artifacts.

Robustness checks run outside the suite (scripts in the session, results rendered with `scripts/render-pdf-page.mjs`): Chrome-generated PDF (object streams, embedded fonts), AcroForm PDF, CropBox-offset PDF and owner-password-encrypted PDF all stamp correctly.

**Not covered by automation:** a physical iOS/Android device (WebKit desktop engine and mobile viewport emulation are covered), screen-reader pass, and real-world scanned PDFs (wasm image decoders are configured but not exercised with a JBIG2 sample).
