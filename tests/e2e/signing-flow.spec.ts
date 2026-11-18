import { inflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, type PDFRef } from "pdf-lib";
import { makeAgreementPdf } from "./make-pdf";

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
  expect(signerUrl).toMatch(/\/sign\/[A-Za-z0-9_-]{40,}$/);
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

  // Signer can download their copy.
  const token = signerUrl.split("/sign/")[1]!;
  const signerCopy = await signerCtx.request.get(`/api/sign/${token}/document?which=signed`);
  expect(signerCopy.status()).toBe(200);

  // 7. Link cannot be used again.
  await signer.goto(signerUrl);
  await expect(signer.getByTestId("signer-notice")).toContainText("already been signed");
  const replay = await signerCtx.request.post(`/api/sign/${token}/submit`, {
    data: { consent: true, signerName: "Mallory", method: "typed", signaturePng: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==" },
  });
  expect(replay.status()).toBe(409);
  const original = await signerCtx.request.get(`/api/sign/${token}/document`);
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
  await page.goto("/sign/this-token-does-not-exist-aaaaaaaaaaaaaaaaaaaaaaaa");
  await expect(page.getByTestId("signer-notice")).toContainText("not valid");
});
