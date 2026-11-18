import { chromium } from "@playwright/test";
const BASE = "https://astra-sign-sprint.vercel.app";
const b = await chromium.launch(); const c = await b.newContext(); const p = await c.newPage();
await p.goto(BASE); await p.getByRole("button", { name: "Open demo workspace" }).click(); await p.waitForURL(/dashboard/);
await p.getByLabel("Case / file name").fill("QA oversize"); await p.getByLabel("Client name").fill("Casey Synthetic"); await p.getByLabel("Client email").fill("casey@example.test");
await p.getByRole("button", { name: "Create case" }).click(); await p.waitForURL(/cases/);
console.log("file inputs:", await p.locator('input[type="file"]').count());
await p.locator('input[type="file"]').first().setInputFiles("qa/artifacts/pdfs/big-26mb.pdf");
await p.getByTestId("upload-error").waitFor({ timeout: 20000 });
console.log("fresh case 26MB:", await p.getByTestId("upload-error").innerText());
// replace flow on a case with a document
await p.locator('input[type="file"]').first().setInputFiles("qa/artifacts/pdfs/B-harborpine-3p-chromium.pdf");
await p.getByTestId("pdf-page-1").locator("canvas").first().waitFor({ timeout: 60000 });
await p.getByRole("button", { name: "Replace PDF" }).click();
await p.waitForTimeout(500);
console.log("file inputs after Replace:", await p.locator('input[type="file"]').count());
await p.locator('input[type="file"]').first().setInputFiles("qa/artifacts/pdfs/big-26mb.pdf");
try { await p.getByTestId("upload-error").waitFor({ timeout: 10000 }); console.log("replace 26MB:", await p.getByTestId("upload-error").innerText()); } catch { console.log("replace: no error"); }
await p.screenshot({ path: "qa/artifacts/adv-oversize-replace.png" });
await b.close();
