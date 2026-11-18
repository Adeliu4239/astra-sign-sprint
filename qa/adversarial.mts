/* eslint-disable @typescript-eslint/no-explicit-any -- browser-evaluated QA harness */
/* Adversarial QA against production. Usage: npx tsx qa/adversarial.mts */
import { chromium, devices, type Page, type BrowserContext } from "@playwright/test";
import { writeFileSync } from "node:fs";
const BASE = process.env.BASE ?? "https://astra-sign-sprint.vercel.app";
const A = "qa/artifacts", P = `${A}/pdfs`;
const results: { id: string; result: string; detail: string }[] = [];
const rec = (id: string, ok: boolean | "INFO", detail: string) => { results.push({ id, result: ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL", detail }); console.log(`[${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}] ${id}: ${detail}`); };
const b = await chromium.launch();
const _nc = b.newContext.bind(b);
(b as any).newContext = async (o?: any) => { const c = await _nc(o); await c.addInitScript("globalThis.__name = (f) => f;"); return c; };

async function newWorkspace(ctx: BrowserContext) {
  const p = await ctx.newPage(); await p.goto(BASE); await p.getByRole("button", { name: "Open demo workspace" }).click(); await p.waitForURL(/dashboard/); return p;
}
async function newCase(p: Page, name: string, client = "Casey Synthetic") {
  await p.goto(`${BASE}/dashboard`);
  await p.getByLabel("Case / file name").fill(name); await p.getByLabel("Client name").fill(client); await p.getByLabel("Client email").fill("casey@example.test");
  await p.getByRole("button", { name: "Create case" }).click(); await p.waitForURL(/\/cases\//); return p.url();
}
async function upload(p: Page, file: string) {
  await p.locator('input[type="file"]').setInputFiles(file);
}
async function waitRendered(p: Page) { await p.getByTestId("pdf-page-1").locator("canvas").first().waitFor({ timeout: 60_000 }); }
let reqId = ""; let docUrl = "";
function sniff(p: Page) { p.on("request", (r) => { const m = r.url().match(/\/api\/requests\/([0-9a-f-]{36})\//); if (m) reqId = m[1]; if (/\/api\/documents\//.test(r.url())) docUrl = r.url(); }); }
async function place(p: Page, tool: string, page: number, nx: number, ny: number) {
  await p.getByRole("button", { name: new RegExp(`^\\+?\\s*${tool}`) }).click();
  const o = p.getByTestId(`pdf-page-${page}`).locator("[data-page-overlay]"); await o.scrollIntoViewIfNeeded();
  const bb = (await o.boundingBox())!; await p.mouse.click(bb.x + bb.width * nx, bb.y + bb.height * ny);
}
async function saved(p: Page) { await p.getByTestId("save-state").filter({ hasText: /^Saved$/ }).waitFor({ timeout: 15_000 }); }
async function createLink(p: Page) { await p.getByRole("button", { name: "Create signing link" }).click(); const u = p.getByTestId("signer-url"); await u.waitFor(); return u.inputValue(); }
async function signerText(ctx: BrowserContext, link: string) { const sp = await ctx.newPage(); await sp.goto(link); await sp.waitForLoadState("networkidle"); await sp.waitForTimeout(1200); const t = (await sp.locator("main").innerText()).replace(/\s+/g, " "); return { sp, t }; }

// ---------- 1. Bad uploads ----------
const ctxA = await b.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const pA = await newWorkspace(ctxA); sniff(pA);
const badCaseUrl = await newCase(pA, "QA adversarial uploads");
for (const [f, label] of [["bad-truncated.pdf", "truncated PDF"], ["bad-garbage-header.pdf", "garbage after %PDF header"], ["bad-renamed-text.pdf", "text file renamed .pdf"], ["bad-password-required.pdf", "password-required PDF"]] as const) {
  await pA.goto(badCaseUrl); await upload(pA, `${P}/${f}`);
  const err = pA.getByTestId("upload-error");
  try { await err.waitFor({ timeout: 30_000 }); const t = await err.innerText(); rec(`upload:${label}`, true, `rejected with "${t}"`); await pA.screenshot({ path: `${A}/adv-upload-${f}.png` }); }
  catch { rec(`upload:${label}`, false, `no error shown; page: ${(await pA.locator("main").innerText()).slice(0, 200)}`); await pA.screenshot({ path: `${A}/adv-upload-${f}-FAIL.png` }); }
}
// recover: valid upload after errors on same case
await pA.goto(badCaseUrl); await upload(pA, `${P}/ok-owner-restricted.pdf`);
try { await waitRendered(pA); rec("upload:owner-restricted PDF accepted after previous errors", true, (await pA.getByTestId("document-meta").innerText()).replace(/\s+/g, " ")); } catch { rec("upload:owner-restricted", false, "did not render"); }

// ---------- 2. Refresh during placement (before autosave completes) ----------
const dialogs: string[] = []; pA.on("dialog", async (d) => { dialogs.push(d.type()); await d.accept(); });
await place(pA, "Signature", 2, 0.4, 0.5);
const state = await pA.getByTestId("save-state").innerText();
await pA.reload(); await waitRendered(pA); await pA.waitForTimeout(1500);
const afterQuick = await pA.getByTestId("placed-field").count();
rec("refresh immediately after placing (before 700ms autosave)", "INFO", `save-state was "${state}", beforeunload dialogs=${JSON.stringify(dialogs)}, fields after reload=${afterQuick}`);
if (afterQuick === 0) { await place(pA, "Signature", 2, 0.4, 0.5); }
await saved(pA); await pA.reload(); await waitRendered(pA); await pA.getByTestId("placed-field").first().waitFor();
rec("refresh after 'Saved'", (await pA.getByTestId("placed-field").count()) === 1, `fields after reload=${await pA.getByTestId("placed-field").count()}`);
// move by keyboard and confirm persisted
await pA.getByTestId("placed-field").first().click(); const before = await pA.getByTestId("placed-field").first().boundingBox();
for (let i = 0; i < 5; i++) await pA.keyboard.press("ArrowRight");
await saved(pA); await pA.reload(); await waitRendered(pA); await pA.getByTestId("placed-field").first().waitFor();
const after = await pA.getByTestId("placed-field").first().boundingBox();
rec("keyboard nudge persisted across refresh", !!before && !!after && after.x > before.x, `x ${before?.x.toFixed(1)} -> ${after?.x.toFixed(1)}`);

// ---------- 3. Name/date fields + Unicode/CJK signer name ----------
await place(pA, "Full name", 2, 0.4, 0.62); await place(pA, "Date signed", 2, 0.75, 0.62); await saved(pA);
const link1 = await createLink(pA);
const requestIdA = reqId;
// edit fields after link created via API (should be locked)
const lockRes = await pA.evaluate(async (id) => { const r = await fetch(`/api/requests/${id}/fields`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: [{ kind: "signature", pageIndex: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.1 }] }) }); return `${r.status} ${await r.text()}`; }, requestIdA);
rec("edit fields after link issued (API)", !lockRes.startsWith("2"), lockRes.slice(0, 160));

// ---------- 4. Server-side duplicate submit (concurrent) + tampered payloads ----------
const sctx = await b.newContext({ ...devices["Pixel 7"] });
const { sp, t: openT } = await signerText(sctx, link1);
rec("signer page opens on Pixel 7 viewport", /review/i.test(openT), openT.slice(0, 120));
const token = link1.split("#")[1];
const storage = await sp.evaluate(() => JSON.stringify({ ls: Object.keys(localStorage), ss: Object.keys(sessionStorage), cookie: document.cookie }));
rec("signer token not persisted in web storage/cookies", !storage.includes(token), storage);
const tamper = await sp.evaluate(async (tok) => {
  const post = (body: unknown, t = tok) => fetch("/api/sign/submit", { method: "POST", headers: { "Content-Type": "application/json", "x-signing-token": t }, body: JSON.stringify(body) }).then(async (r) => `${r.status} ${(await r.text()).slice(0, 100)}`);
  return {
    noConsent: await post({ consent: false, signerName: "X", method: "drawn", signaturePng: "data:image/png;base64,iVBORw0KGgo=" }),
    notPng: await post({ consent: true, signerName: "X", method: "drawn", signaturePng: "data:image/svg+xml;base64,PHN2Zz4=" }),
    emptyName: await post({ consent: true, signerName: "  ", method: "drawn", signaturePng: "data:image/png;base64,iVBORw0KGgo=" }),
    badPngBytes: await post({ consent: true, signerName: "X", method: "drawn", signaturePng: "data:image/png;base64,AAAAAAAA" }),
    wrongToken: await post({ consent: true, signerName: "X", method: "drawn", signaturePng: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAAgAAQ3cs1YAAAAASUVORK5CYII=" }, "A".repeat(43)),
    noToken: await fetch("/api/sign/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => String(r.status)),
  };
}, token);
for (const [k, v] of Object.entries(tamper)) rec(`tampered submit: ${k}`, /^4\d\d/.test(v), v);

// real signature: typed CJK/Unicode name, concurrent double submit
await sp.getByLabel(/full legal name/i).fill("王小明 Zoë Ünal-Łukasz");
await sp.getByRole("tab", { name: /^type$/i }).click();
await sp.getByTestId("typed-signature").fill("王小明 Zoë Ünal");
await sp.getByRole("checkbox").check();
await sp.screenshot({ path: `${A}/adv-unicode-signer-preview.png`, fullPage: true });
// capture the client-built signature PNG via a monkeypatched fetch, then race 3 submits
await sp.evaluate(() => { const o = window.fetch; (window as any).__bodies = []; window.fetch = (i: any, init?: any) => { if (String(i).includes("/api/sign/submit")) (window as any).__bodies.push(init?.body); return o(i, init); }; });
await sp.getByRole("button", { name: /agree & sign/i }).click();
await sp.getByTestId("signing-complete").waitFor({ timeout: 60_000 });
const race = await sp.evaluate(async (tok) => { const body = (window as any).__bodies[0]; const go = () => fetch("/api/sign/submit", { method: "POST", headers: { "Content-Type": "application/json", "x-signing-token": tok }, body }).then((r) => r.status); return Promise.all([go(), go(), go()]); }, token);
rec("replay ×3 concurrent submits after completion", race.every((s) => s === 409), JSON.stringify(race));
await sp.screenshot({ path: `${A}/adv-unicode-signer-done.png` });

// fresh case for a true concurrent first-submit race (API level)
const raceCaseUrl = await newCase(pA, "QA race");
await upload(pA, `${P}/A-northwind-5p-mixed.pdf`); await waitRendered(pA); await place(pA, "Signature", 2, 0.5, 0.5); await saved(pA);
const raceLink = await createLink(pA); const raceTok = raceLink.split("#")[1];
const rctx = await b.newContext(); const { sp: rp } = await signerText(rctx, raceLink);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAAgAAQ3cs1YAAAAASUVORK5CYII=";
const first = await rp.evaluate(async ({ tok, png }) => { const go = () => fetch("/api/sign/submit", { method: "POST", headers: { "Content-Type": "application/json", "x-signing-token": tok }, body: JSON.stringify({ consent: true, signerName: "Race Tester", method: "drawn", signaturePng: png }) }).then((r) => r.status); return Promise.all([go(), go(), go(), go(), go()]); }, { tok: raceTok, png: PNG });
rec("5 concurrent FIRST submits", first.filter((s) => s === 201).length === 1 && first.filter((s) => s === 409).length === 4, JSON.stringify(first));
await pA.goto(raceCaseUrl); await pA.getByTestId("event-log").waitFor();
const raceLog = await pA.getByTestId("event-log").innerText();
rec("race: event log shows single completion + rejected attempts", (raceLog.match(/completed/gi) ?? []).length === 1, raceLog.replace(/\n/g, " | ").slice(-500));
await rctx.close();

// download Unicode signed PDF via admin
await pA.goto(`${BASE}/dashboard`); await pA.getByText("QA adversarial uploads").click(); await pA.getByTestId("download-signed").waitFor({ timeout: 30_000 });
const dl = pA.waitForEvent("download"); await pA.getByTestId("download-signed").click(); await (await dl).saveAs(`${A}/adv-unicode-signed.pdf`);
rec("Unicode signed PDF downloaded", true, `${A}/adv-unicode-signed.pdf`);

// ---------- 5. Revoke / restart / old link ----------
const revCaseUrl = await newCase(pA, "QA revoke");
await upload(pA, `${P}/B-harborpine-3p-chromium.pdf`); await waitRendered(pA); await place(pA, "Signature", 3, 0.3, 0.64); await saved(pA);
const revLink = await createLink(pA);
await pA.getByRole("button", { name: /revoke/i }).click();
await pA.waitForTimeout(2500);
const vctx = await b.newContext(); let r1 = await signerText(vctx, revLink);
rec("revoked link blocked", /revoked|no longer|cancel/i.test(r1.t), r1.t.slice(0, 160)); await r1.sp.screenshot({ path: `${A}/adv-revoked-link.png` });
await pA.goto(revCaseUrl); await pA.screenshot({ path: `${A}/adv-revoked-admin.png`, fullPage: true });
const restartBtn = pA.getByRole("button", { name: /new request|restart|start/i }).first();
await restartBtn.click(); await pA.waitForLoadState("networkidle"); await pA.waitForTimeout(1500);
const fieldsKept = await pA.getByTestId("placed-field").count();
const newLink = await createLink(pA);
r1 = await signerText(vctx, revLink); const r2 = await signerText(vctx, newLink);
rec("restart: fields kept, new link works, old link still blocked", fieldsKept === 1 && newLink !== revLink && /review/i.test(r2.t) && !/review and sign/i.test(r1.t), `fields=${fieldsKept}; old: ${r1.t.slice(0, 70)} | new: ${r2.t.slice(0, 70)}`);
await vctx.close();

// ---------- 6. Malformed links ----------
const mctx = await b.newContext();
for (const [lbl, u] of [["no fragment", `${BASE}/sign`], ["random token", `${BASE}/sign#${"x".repeat(43)}`], ["truncated token", newLink.slice(0, -10)], ["old path-style token", `${BASE}/sign/${newLink.split("#")[1]}`]]) {
  const { sp: m, t } = await signerText(mctx, u); rec(`malformed link: ${lbl}`, !/review and sign/i.test(t), t.slice(0, 130)); await m.close();
}
await mctx.close();

// ---------- 7. Cross-workspace / unauthenticated ----------
const ctxB = await b.newContext(); const pB = await newWorkspace(ctxB);
const caseIdA = revCaseUrl.split("/cases/")[1];
const pageRes = await pB.goto(revCaseUrl); rec("other workspace opens case page", pageRes?.status() === 404, `HTTP ${pageRes?.status()}`);
const apiB = await pB.evaluate(async ({ reqA, doc, caseId }) => {
  const s = async (u: string, init?: RequestInit) => { const r = await fetch(u, init); return r.status; };
  return {
    doc: doc ? await s(doc) : -1,
    fields: await s(`/api/requests/${reqA}/fields`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: [] }) }),
    send: await s(`/api/requests/${reqA}/send`, { method: "POST" }),
    revoke: await s(`/api/requests/${reqA}/revoke`, { method: "POST" }),
    restart: await s(`/api/requests/${reqA}/restart`, { method: "POST" }),
    upload: await s(`/api/cases/${caseId}/uploads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "x.pdf", size: 5000000 }) }),
  };
}, { reqA: requestIdA, doc: docUrl, caseId: caseIdA });
rec("other workspace API access to A's resources", Object.values(apiB).every((s) => s === 404 || s === 403), JSON.stringify(apiB) + ` (doc url sniffed: ${docUrl ? "yes" : "no"})`);
await pB.goto(`${BASE}/dashboard`); const dashT = await pB.locator("main").innerText();
rec("other workspace dashboard lists none of A's cases", !/QA revoke|QA adversarial/.test(dashT), dashT.replace(/\s+/g, " ").slice(0, 100));
const anon = await b.newContext();
const anonRes = await anon.request.get(docUrl || `${BASE}/api/documents/00000000-0000-0000-0000-000000000000`);
const anonCase = await anon.request.get(revCaseUrl, { maxRedirects: 0 });
const anonDash = await anon.request.get(`${BASE}/dashboard`, { maxRedirects: 0 });
rec("no-cookie access", anonRes.status() === 401 && anonCase.status() !== 200, `document ${anonRes.status()}, case page ${anonCase.status()}, dashboard ${anonDash.status()}`);
// signer token cannot reach admin APIs; admin cookie cannot read signer doc without token
const tokAdmin = await anon.request.put(`${BASE}/api/requests/${requestIdA}/fields`, { headers: { "x-signing-token": newLink.split("#")[1], "content-type": "application/json" }, data: { fields: [] } });
rec("signer token grants no admin API access", tokAdmin.status() === 401, `HTTP ${tokAdmin.status()}`);
const forged = await anon.request.get(`${BASE}/dashboard`, { headers: { cookie: "fs_ws=" + "a".repeat(43) }, maxRedirects: 0 });
rec("forged workspace cookie", forged.status() !== 200 || !(await forged.text()).includes("QA revoke"), `HTTP ${forged.status()}`);

// ---------- 8. Headers ----------
const h = await anon.request.get(BASE); const hs = h.headers();
rec("security headers on HTML", !!hs["x-frame-options"] && hs["referrer-policy"] === "no-referrer" && hs["x-content-type-options"] === "nosniff", JSON.stringify({ xfo: hs["x-frame-options"], ref: hs["referrer-policy"], nosniff: hs["x-content-type-options"], hsts: hs["strict-transport-security"], csp: hs["content-security-policy"] ?? "none", powered: hs["x-powered-by"] ?? "none" }));
const ck = (await ctxA.cookies()).find((c) => c.name === "fs_ws");
rec("workspace cookie flags", !!ck && ck.httpOnly && ck.secure && ck.sameSite === "Lax", JSON.stringify({ httpOnly: ck?.httpOnly, secure: ck?.secure, sameSite: ck?.sameSite, expires: ck ? new Date(ck.expires * 1000).toISOString() : null }));

// ---------- 9. Form validation & no-field link ----------
await pA.goto(`${BASE}/dashboard`);
const v = await pA.evaluate(async () => { const r = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "", clientName: "x", clientEmail: "not-an-email" }) }); return `${r.status} ${await r.text()}`; });
rec("create case with invalid data (API)", v.startsWith("400"), v.slice(0, 160));
await newCase(pA, "QA no-fields"); await upload(pA, `${P}/B-harborpine-3p-chromium.pdf`); await waitRendered(pA);
await pA.getByRole("button", { name: "Create signing link" }).click(); await pA.waitForTimeout(2000);
const noFieldLink = await pA.getByTestId("signer-url").count();
rec("create link with no signature field blocked", noFieldLink === 0, (await pA.locator("aside, [role=alert]").allInnerTexts()).join(" | ").replace(/\s+/g, " ").slice(0, 200));
await pA.screenshot({ path: `${A}/adv-no-fields.png` });
// oversize: client-side check with a 26 MB sparse file
writeFileSync(`${P}/big-26mb.pdf`, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(26 * 1024 * 1024)]));
await upload(pA, `${P}/big-26mb.pdf`);
try { await pA.getByTestId("upload-error").waitFor({ timeout: 20_000 }); rec("26 MB upload rejected", true, await pA.getByTestId("upload-error").innerText()); } catch { rec("26 MB upload rejected", false, "no error"); }

// ---------- 10. Admin back/forward after creating link ----------
await pA.goto(`${BASE}/dashboard`); await pA.getByText("QA revoke").click(); await pA.waitForURL(/cases/);
await pA.goBack(); await pA.goForward(); await pA.waitForLoadState("networkidle");
rec("admin back/forward keeps state", (await pA.getByTestId("signer-url").count()) === 1, `link panel visible after back/forward: ${(await pA.getByTestId("signer-url").count()) === 1}`);

writeFileSync(`${A}/adversarial-results.json`, JSON.stringify(results, null, 2));
await b.close();
