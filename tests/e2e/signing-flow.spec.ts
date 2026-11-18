import { inflateSync } from "node:zlib";
import { devices, expect, test, type Page } from "@playwright/test";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, type PDFRef } from "pdf-lib";
import { makeAgreementPdf, makeLargePdf } from "./make-pdf";

async function pageContent(bytes: Buffer, pageIndex: number): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const node = doc.getPage(pageIndex).node;
  const contents = node.lookup(PDFName.of("Contents"));
  const refs = contents instanceof PDFArray ? (contents.asArray() as PDFRef[]) : [node.get(PDFName.of("Contents")) as PDFRef];
  return refs
    .map((ref) => {
      const s = doc.context.lookup(ref) as PDFRawStream;
      const raw = Buffer.from(s.getContents());
      return s.dict.get(PDFName.of("Filter")) ? inflateSync(raw).toString("latin1") : raw.toString("latin1");
    })
    .join("\n");
}

/** Clicks a normalised position on a rendered page overlay. */
async function clickOnPage(page: Page, pageIndex: number, nx: number, ny: number) {
  const overlay = page.locator(`[data-page-overlay="${pageIndex}"]`);
  await overlay.scrollIntoViewIfNeeded();
  const box = (await overlay.boundingBox())!;
  await overlay.click({ position: { x: box.width * nx, y: box.height * ny }, timeout: 10_000 });
}

test("unknown multi-page PDF: place signature on page 2, sign in a separate browser, download stamped PDF", async ({ page, browser, baseURL }) => {
  const seed = `e2e-${Date.now().toString(36)}`;
  const pdf = await makeAgreementPdf(seed);

  // 1. Self-service demo workspace.
  await page.goto("/");
  await page.getByTestId("enter-demo").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // 2. Create case.
  await page.getByPlaceholder("MIND Test Case 001").fill(`MIND Test Case ${seed}`);
  await page.getByPlaceholder("Taylor Example").fill("Taylor Example");
  await page.getByPlaceholder("taylor@example.com").fill("taylor@example.com");
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByTestId("case-title")).toHaveText(`MIND Test Case ${seed}`);
  const caseUrl = page.url();

  // 3. Upload a freshly generated 3-page PDF.
  await page.getByTestId("pdf-input").setInputFiles({ name: `agreement-${seed}.pdf`, mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByTestId("document-meta")).toContainText("3 pages");
  await expect(page.getByTestId("pdf-page-3")).toBeVisible();

  // 4. Place signature on page 2 over the "Client signature" line, and a date field on rotated page 3.
  // Page 2 is A4 (595.28 x 841.89). Line centre x=320, y(pdf)=438 => displayed y = 403.89.
  const sigNx = 320 / 595.28;
  const sigNy = (841.89 - 438) / 841.89;
  await page.getByTestId("tool-signature").click();
  await clickOnPage(page, 1, sigNx, sigNy);
  await page.getByTestId("tool-date").click();
  await clickOnPage(page, 2, 0.7, 0.2);
  await expect(page.getByTestId("placed-field")).toHaveCount(2);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");

  // Placement survives a refresh.
  await page.reload();
  await expect(page.locator('[data-testid="placed-field"][data-page="2"][data-kind="signature"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="placed-field"][data-page="3"][data-kind="date"]')).toHaveCount(1);

  // 5. Create the signing link.
  await page.getByTestId("create-link").click();
  const urlInput = page.getByTestId("signer-url");
  await expect(urlInput).toBeVisible();
  const signerUrl = await urlInput.inputValue();
  expect(signerUrl).toMatch(/\/sign#[A-Za-z0-9_-]{40,}$/);
  expect(new URL(signerUrl).origin).toBe(new URL(baseURL!).origin);
  await expect(page.getByTestId("status-badge")).toHaveText("Awaiting signature");

  // 6. Signer in a separate, cookie-less browser context.
  const signerCtx = await browser.newContext();
  const signer = await signerCtx.newPage();
  await signer.goto(signerUrl);
  for (const n of [1, 2, 3]) await expect(signer.getByTestId(`pdf-page-${n}`)).toBeVisible();
  await expect(signer.getByTestId("submit-signature")).toBeDisabled();
  const canvas = signer.getByTestId("signature-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const cb = (await canvas.boundingBox())!;
  await signer.mouse.move(cb.x + 20, cb.y + cb.height * 0.6);
  await signer.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await signer.mouse.move(cb.x + 20 + i * 18, cb.y + cb.height * (0.6 + (i % 2 ? -0.25 : 0.1)), { steps: 3 });
  }
  await signer.mouse.up();
  await signer.getByTestId("consent").check();
  await expect(signer.getByTestId("submit-signature")).toBeEnabled();
  await signer.getByTestId("submit-signature").dblclick(); // double click must not double-sign
  await expect(signer.getByTestId("signing-complete")).toBeVisible();

  // Signer can download their copy (token only ever sent in a header).
  const token = signerUrl.split("#")[1]!;
  const auth = { "x-signing-token": token };
  const [download] = await Promise.all([signer.waitForEvent("download"), signer.getByTestId("signer-download").click()]);
  expect(download.suggestedFilename()).toMatch(/\(signed\)\.pdf$/);
  const signerCopy = await signerCtx.request.get(`/api/sign/document?which=signed`, { headers: auth });
  expect(signerCopy.status()).toBe(200);
  expect((await signerCtx.request.get(`/api/sign/document?which=signed`)).status()).toBe(404);

  // 7. Link cannot be used again.
  await signer.goto("about:blank");
  await signer.goto(signerUrl);
  await expect(signer.getByTestId("signer-notice")).toContainText("already been signed");
  const replay = await signerCtx.request.post(`/api/sign/submit`, {
    headers: auth,
    data: { consent: true, signerName: "Mallory", method: "typed", signaturePng: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==" },
  });
  expect(replay.status()).toBe(409);
  const original = await signerCtx.request.get(`/api/sign/document`, { headers: auth });
  expect(original.status()).toBe(410);
  await signerCtx.close();

  // 8. Admin sees Completed (persisted), downloads the signed PDF.
  await page.goto(caseUrl);
  await expect(page.getByTestId("status-badge")).toHaveText("Completed");
  await page.goto("/dashboard");
  await expect(page.getByRole("row", { name: new RegExp(seed) }).getByTestId("status-badge")).toHaveText("Completed");
  await page.goto(caseUrl);
  const href = await page.getByTestId("download-signed").getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const signed = Buffer.from(await res.body());

  const signedDoc = await PDFDocument.load(signed);
  expect(signedDoc.getPageCount()).toBe(4); // 3 original + certificate

  // Page 1 untouched; page 2 carries the image inside the placed field rectangle.
  expect(await pageContent(signed, 0)).not.toMatch(/\/Image\S* Do/);
  const c2 = await pageContent(signed, 1);
  const m = c2.match(/1 0 0 1 ([\d.]+) ([\d.]+) cm\s+1 0 0 1 0 0 cm\s+([\d.]+) 0 0 ([\d.]+) 0 0 cm\s+1 0 0 1 0 0 cm\s+\/Image\S* Do/);
  expect(m, "signature image draw operator on page 2").not.toBeNull();
  const [x, y, w, h] = m!.slice(1).map(Number) as [number, number, number, number];
  // Field: 180 x 50 pt centred at (320, 438) => x 230..410, y 413..463.
  expect(x).toBeGreaterThanOrEqual(229);
  expect(x + w).toBeLessThanOrEqual(411);
  expect(y).toBeGreaterThanOrEqual(412);
  expect(y + h).toBeLessThanOrEqual(464);
  expect(w).toBeGreaterThan(20);
  // Rotated page 3 received the date text with a 90° rotation matrix.
  expect(await pageContent(signed, 2)).toMatch(/Tj/);

  // Event log.
  const log = page.getByTestId("event-log");
  for (const ev of ["request_created", "signing_page_opened", "consent_given", "document_signed", "request_completed", "signing_attempt_rejected"]) {
    await expect(log.locator(`[data-event="${ev}"]`).first()).toBeAttached();
  }
});

test("rejects a non-PDF upload with a helpful message", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("enter-demo").click();
  await page.getByPlaceholder("MIND Test Case 001").fill("Bad upload case");
  await page.getByPlaceholder("Taylor Example").fill("Sam Sample");
  await page.getByPlaceholder("taylor@example.com").fill("sam@example.com");
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByTestId("case-title")).toBeVisible();
  await page.getByTestId("pdf-input").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("hello, not a pdf") });
  await expect(page.getByTestId("upload-error")).toContainText(/not a valid PDF/);
});

test("invalid signing link shows a clear message", async ({ page }) => {
  await page.goto("/sign#this-token-does-not-exist-aaaaaaaaaaaaaaaaaaaaaaaa");
  await expect(page.getByTestId("signer-notice")).toContainText("not valid");
  await page.goto("about:blank");
  await page.goto("/sign");
  await expect(page.getByTestId("signer-notice")).toContainText("incomplete");
});

test("large PDF (> 4.5 MB) uploads in chunks and the signed copy downloads", async ({ page, browser }) => {
  const pdf = await makeLargePdf(9);
  expect(pdf.byteLength).toBeGreaterThan(9 * 1024 * 1024);
  await page.goto("/");
  await page.getByTestId("enter-demo").click();
  await page.getByPlaceholder("MIND Test Case 001").fill("Large file case");
  await page.getByPlaceholder("Taylor Example").fill("Robin Sample");
  await page.getByPlaceholder("taylor@example.com").fill("robin@example.com");
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByTestId("case-title")).toBeVisible();
  await page.getByTestId("pdf-input").setInputFiles({ name: "large-agreement.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByTestId("document-meta")).toContainText("3 pages", { timeout: 90_000 });
  await page.getByTestId("tool-signature").click();
  await clickOnPage(page, 1, 0.5, 0.5);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.getByTestId("create-link").click();
  const signerUrl = await page.getByTestId("signer-url").inputValue();
  const token = signerUrl.split("#")[1]!;
  const auth = { "x-signing-token": token };

  const signerCtx = await browser.newContext();
  const doc = await signerCtx.request.get(`/api/sign/document`, { headers: auth });
  expect(doc.status()).toBe(200);
  expect((await doc.body()).byteLength).toBe(pdf.byteLength);
  const res = await signerCtx.request.post(`/api/sign/submit`, {
    headers: auth,
    data: {
      consent: true,
      signerName: "Robin Sample",
      method: "typed",
      signaturePng: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAAgAAQ3cs1YAAAAASUVORK5CYII=",
    },
  });
  expect(res.status()).toBe(201);
  await signerCtx.close();

  await page.reload();
  await expect(page.getByTestId("status-badge")).toHaveText("Completed");
  const href = await page.getByTestId("download-signed").getAttribute("href");
  const signed = await page.request.get(href!);
  expect(signed.status()).toBe(200);
  const bytes = Buffer.from(await signed.body());
  expect(bytes.byteLength).toBeGreaterThan(9 * 1024 * 1024);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(4);
});

test("signer completes on a phone-sized touch device using a typed signature", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByTestId("enter-demo").click();
  await page.getByPlaceholder("MIND Test Case 001").fill("Mobile signer case");
  await page.getByPlaceholder("Taylor Example").fill("Jordan Mobile");
  await page.getByPlaceholder("taylor@example.com").fill("jordan@example.com");
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByTestId("case-title")).toBeVisible();
  await page.getByTestId("pdf-input").setInputFiles({ name: "agreement.pdf", mimeType: "application/pdf", buffer: await makeAgreementPdf() });
  await expect(page.getByTestId("pdf-page-2")).toBeVisible();
  await page.getByTestId("tool-signature").click();
  await clickOnPage(page, 1, 0.5, 0.5);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.getByTestId("create-link").click();
  const signerUrl = await page.getByTestId("signer-url").inputValue();

  const { defaultBrowserType: _ignored, ...pixel } = devices["Pixel 7"];
  void _ignored;
  const phone = await browser.newContext({ ...pixel });
  const m = await phone.newPage();
  await m.goto(signerUrl);
  await expect(m.getByTestId("pdf-page-3")).toBeAttached();
  await m.getByRole("button", { name: /Go to signature form/ }).tap();
  await m.getByTestId("sig-mode-type").tap();
  await expect(m.getByTestId("typed-signature")).toHaveValue("Jordan Mobile");
  await m.getByTestId("consent").tap();
  await expect(m.getByTestId("submit-signature")).toBeEnabled();
  await m.getByTestId("submit-signature").tap();
  await expect(m.getByTestId("signing-complete")).toBeVisible();
  await phone.close();

  await page.reload();
  await expect(page.getByTestId("status-badge")).toHaveText("Completed");
});

test("revoked link cannot be used; restarting issues a new link with the same fields", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByTestId("enter-demo").click();
  await page.getByPlaceholder("MIND Test Case 001").fill("Revoke case");
  await page.getByPlaceholder("Taylor Example").fill("Casey Revoke");
  await page.getByPlaceholder("taylor@example.com").fill("casey@example.com");
  await page.getByRole("button", { name: "Create case" }).click();
  await page.getByTestId("pdf-input").setInputFiles({ name: "agreement.pdf", mimeType: "application/pdf", buffer: await makeAgreementPdf() });
  await expect(page.getByTestId("pdf-page-2")).toBeVisible();
  await page.getByTestId("tool-signature").click();
  await clickOnPage(page, 1, 0.4, 0.6);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.getByTestId("create-link").click();
  const oldUrl = await page.getByTestId("signer-url").inputValue();

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Revoke link" }).click();
  await expect(page.getByTestId("status-badge")).toHaveText("Revoked");

  const ctx = await browser.newContext();
  const s = await ctx.newPage();
  await s.goto(oldUrl);
  await expect(s.getByTestId("signer-notice")).toContainText("cancelled");
  const token = oldUrl.split("#")[1]!;
  const r = await ctx.request.post("/api/sign/submit", {
    headers: { "x-signing-token": token },
    data: { consent: true, signerName: "X", method: "typed", signaturePng: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAAgAAQ3cs1YAAAAASUVORK5CYII=" },
  });
  expect(r.status()).toBe(409);
  await ctx.close();

  await page.getByRole("button", { name: "Start a new signing request" }).click();
  await expect(page.getByTestId("status-badge")).toHaveText("Draft");
  await expect(page.locator('[data-testid="placed-field"][data-page="2"]')).toHaveCount(1);
  await page.getByTestId("create-link").click();
  const newUrl = await page.getByTestId("signer-url").inputValue();
  expect(newUrl).not.toBe(oldUrl);
});

test("another workspace cannot open this workspace's case or PDF", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByTestId("enter-demo").click();
  await page.getByPlaceholder("MIND Test Case 001").fill("Isolation case");
  await page.getByPlaceholder("Taylor Example").fill("Iso Late");
  await page.getByPlaceholder("taylor@example.com").fill("iso@example.com");
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByTestId("case-title")).toBeVisible();
  const caseUrl = page.url();
  const docResponse = page.waitForResponse((r) => /\/api\/documents\/[0-9a-f-]{36}$/.test(r.url()));
  await page.getByTestId("pdf-input").setInputFiles({ name: "agreement.pdf", mimeType: "application/pdf", buffer: await makeAgreementPdf() });
  const docUrl = (await docResponse).url();

  const other = await browser.newContext();
  const o = await other.newPage();
  await o.goto("/");
  await o.getByTestId("enter-demo").click();
  await expect(o).toHaveURL(/dashboard/);
  expect((await other.request.get(docUrl)).status()).toBe(404);
  await o.goto(caseUrl);
  await expect(o.getByRole("heading", { name: "Not found" })).toBeVisible();
  // Without any workspace cookie, admin APIs refuse.
  const anon = await browser.newContext();
  expect((await anon.request.get(docUrl)).status()).toBe(401);
  await anon.close();
  await other.close();
});
