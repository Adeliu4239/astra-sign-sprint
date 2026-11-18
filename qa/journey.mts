/* Independent customer journey against production. Usage: npx tsx qa/journey.mts */
import { chromium, devices, type Page, type Browser } from "@playwright/test";
const BASE = process.env.BASE ?? "https://astra-sign-sprint.vercel.app";
const A = "qa/artifacts";
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

interface Spec { tag: string; file: string; caseName: string; client: string; email: string;
  fields: { tool: "Signature" | "Full name" | "Date signed"; page: number; nx: number; ny: number }[];
  sign: "draw" | "type"; signerName: string; mobileSigner?: boolean }

async function placeAt(p: Page, s: Spec["fields"][number]) {
  await p.getByRole("button", { name: new RegExp(`^\\+?\\s*${s.tool}`) }).click();
  const pg = p.getByTestId(`pdf-page-${s.page}`);
  await pg.scrollIntoViewIfNeeded();
  await pg.locator("canvas").first().waitFor();
  const overlay = pg.locator("[data-page-overlay]");
  const box = (await overlay.boundingBox())!;
  await p.mouse.click(box.x + box.width * s.nx, box.y + box.height * s.ny);
}

async function run(browser: Browser, s: Spec) {
  log(`== ${s.tag}: ${s.file}`);
  const admin = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const p = await admin.newPage();
  const consoleErrors: string[] = [];
  p.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  await p.goto(BASE);
  await p.getByRole("button", { name: "Open demo workspace" }).click();
  await p.getByLabel("Case / file name").fill(s.caseName);
  await p.getByLabel("Client name").fill(s.client);
  await p.getByLabel("Client email").fill(s.email);
  await p.getByRole("button", { name: "Create case" }).click();
  await p.waitForURL(/\/cases\//);
  log("case page", p.url().replace(BASE, ""));
  await p.screenshot({ path: `${A}/${s.tag}-1-case-new.png` });
  const t0 = Date.now();
  await p.locator('input[type="file"]').setInputFiles(s.file);
  await p.getByTestId("pdf-page-1").locator("canvas").first().waitFor({ timeout: 60_000 });
  log(`uploaded+rendered in ${Date.now() - t0} ms; meta:`, (await p.getByTestId("document-meta").innerText()).replace(/\s+/g, " "));
  for (const f of s.fields) await placeAt(p, f);
  await p.getByTestId("save-state").filter({ hasText: /^Saved$/ }).waitFor({ timeout: 15_000 });
  log("save-state:", await p.getByTestId("save-state").innerText());
  await p.screenshot({ path: `${A}/${s.tag}-2-fields-placed.png`, fullPage: false });
  // refresh during placement → persistence
  await p.reload();
  await p.getByTestId("placed-field").first().waitFor();
  log("after reload placed fields:", await p.getByTestId("placed-field").count());
  await p.getByRole("button", { name: "Create signing link" }).click();
  const urlBox = p.getByTestId("signer-url");
  await urlBox.waitFor();
  const link = await urlBox.inputValue();
  log("signer link shape:", link.replace(/#.+/, "#<token len " + (link.split("#")[1]?.length ?? 0) + ">"));
  await p.getByRole("button", { name: /copy link/i }).click().catch(() => log("no copy button by role"));
  await p.screenshot({ path: `${A}/${s.tag}-3-link.png` });

  // signer: independent, cookie-less context
  const sctx = await browser.newContext(s.mobileSigner ? { ...devices["iPhone 13"] } : { viewport: { width: 1280, height: 900 } });
  const sp = await sctx.newPage();
  const sErrors: string[] = []; sp.on("console", (m) => m.type() === "error" && sErrors.push(m.text()));
  const reqUrls: string[] = []; sp.on("request", (r) => reqUrls.push(r.url()));
  await sp.goto(link);
  await sp.getByTestId("pdf-page-1").locator("canvas").first().waitFor({ timeout: 60_000 });
  log("signer intro:", (await sp.locator("main").innerText()).split("\n").slice(0, 6).join(" | "));
  await sp.screenshot({ path: `${A}/${s.tag}-4-signer-open.png` });
  await sp.getByLabel(/full legal name/i).fill(s.signerName);
  if (s.sign === "type") {
    await sp.getByRole("tab", { name: /^type$/i }).click();
    const typed = sp.getByTestId("typed-signature"); await typed.fill(s.signerName);
  } else {
    const c = sp.getByTestId("signature-canvas"); await c.scrollIntoViewIfNeeded();
    const bb = (await c.boundingBox())!;
    await sp.mouse.move(bb.x + bb.width * 0.15, bb.y + bb.height * 0.6); await sp.mouse.down();
    for (let i = 0; i <= 30; i++) await sp.mouse.move(bb.x + bb.width * (0.15 + i * 0.023), bb.y + bb.height * (0.6 - 0.3 * Math.sin(i / 3)));
    await sp.mouse.up();
  }
  await sp.getByRole("checkbox").check();
  await sp.screenshot({ path: `${A}/${s.tag}-5-signer-ready.png`, fullPage: true });
  const btn = sp.getByRole("button", { name: /agree & sign/i });
  await btn.dblclick(); // duplicate-submit attempt
  await sp.getByTestId("signing-complete").waitFor({ timeout: 60_000 });
  log("signer done:", (await sp.getByTestId("signing-complete").innerText()).replace(/\s+/g, " "));
  await sp.screenshot({ path: `${A}/${s.tag}-6-signer-done.png` });
  const dl1 = sp.waitForEvent("download"); await sp.getByRole("button", { name: /download signed copy/i }).click();
  const d1 = await dl1; await d1.saveAs(`${A}/${s.tag}-signed-by-signer.pdf`);
  const tokenInLoggableUrl = reqUrls.some((u) => link.split("#")[1] && u.includes(link.split("#")[1]));
  log("token present in any request URL:", tokenInLoggableUrl, "| signer console errors:", sErrors.length);

  // back/forward on signer
  await sp.goBack().catch(() => {}); await sp.goForward().catch(() => {});
  await sp.waitForLoadState("networkidle");
  log("signer after back/forward:", (await sp.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 160));
  // reopen link in yet another fresh context
  const r = await browser.newContext(); const rp = await r.newPage(); await rp.goto(link); await rp.waitForLoadState("networkidle");
  await rp.waitForTimeout(1500);
  log("reopen used link:", (await rp.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200));
  await rp.screenshot({ path: `${A}/${s.tag}-7-link-reused.png` });
  await r.close();

  // admin sees Completed (auto refresh), downloads
  await p.getByText(/completed/i).first().waitFor({ timeout: 30_000 });
  await p.getByTestId("download-signed").waitFor({ timeout: 30_000 });
  await p.screenshot({ path: `${A}/${s.tag}-8-admin-completed.png`, fullPage: true });
  log("event log:\n  " + (await p.getByTestId("event-log").innerText()).split("\n").join("\n  "));
  const dl = p.waitForEvent("download"); await p.getByTestId("download-signed").click();
  const d = await dl; await d.saveAs(`${A}/${s.tag}-signed.pdf`);
  log("admin download filename:", d.suggestedFilename());
  await p.goto(`${BASE}/dashboard`);
  log("dashboard row:", (await p.getByTestId("cases-table").innerText()).replace(/\s+/g, " "));
  await p.screenshot({ path: `${A}/${s.tag}-9-dashboard.png` });
  log("admin console errors:", consoleErrors);
  await admin.close(); await sctx.close();
}

const browser = await chromium.launch();
const specs: Spec[] = [
  { tag: "A", file: `${A}/pdfs/A-northwind-5p-mixed.pdf`, caseName: "QA-A Northwind engagement", client: "Riley Synthetic", email: "riley.synthetic@example.test",
    // page 4: CropBox x30..582 (552 wide), y40..752 (712 tall). Sig line x100..340 @ y300 -> u 70..310, v 452. Center sig 180x50 at u=190 v=430.
    fields: [ { tool: "Signature", page: 4, nx: 190 / 552, ny: 430 / 712 },
              { tool: "Full name", page: 4, nx: (70 + 85) / 552, ny: (752 - 260 - 11) / 712 },
              { tool: "Date signed", page: 4, nx: (330 + 55) / 552, ny: (752 - 260 - 11) / 712 } ],
    sign: "draw", signerName: "Riley Synthetic" },
  { tag: "B", file: `${A}/pdfs/B-harborpine-3p-chromium.pdf`, caseName: "QA-B Harbor & Pine service order", client: "Jordan Q. Tester", email: "jordan.tester@example.test",
    // page 3 (A4 210x297mm): sig line left 25mm..105mm @ top 200mm. Sig 180x50pt = 63.5x17.6mm, center at x=65mm, y=191mm. Date line 120..170mm.
    fields: [ { tool: "Signature", page: 3, nx: 65 / 210, ny: 191 / 297 }, { tool: "Date signed", page: 3, nx: 145 / 210, ny: 196 / 297 } ],
    sign: "type", signerName: "Jordan Q. Tester", mobileSigner: true },
];
for (const s of specs.filter((x) => !process.env.ONLY || x.tag === process.env.ONLY)) await run(browser, s);
await browser.close();
