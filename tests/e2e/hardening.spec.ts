/**
 * Final hardening regressions: case search/filter and stages, replace-PDF confirmation, unsaved-
 * field navigation guard, multiple signature fields with a long Unicode name, dropped connections
 * on submit (request lost, and response lost), duplicate submits, and no CSP violations.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { makeAgreementPdf } from "./make-pdf";

const CSP_PATTERN = /Content[- ]Security[- ]Policy|Refused to (load|execute|connect|apply|create)/i;

function watchCsp(page: Page, sink: string[]) {
  page.on("console", (m) => {
    if (CSP_PATTERN.test(m.text())) sink.push(m.text());
  });
  page.on("pageerror", (e) => {
    if (CSP_PATTERN.test(e.message)) sink.push(e.message);
  });
}

async function clickOnPage(page: Page, pageIndex: number, nx: number, ny: number) {
  const overlay = page.locator(`[data-page-overlay="${pageIndex}"]`);
  await overlay.scrollIntoViewIfNeeded();
  const box = (await overlay.boundingBox())!;
  await overlay.click({ position: { x: box.width * nx, y: box.height * ny }, timeout: 10_000 });
}

async function openWorkspace(page: Page) {
  await page.goto("/");
  await page.getByTestId("enter-demo").click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function createCase(page: Page, title: string, client = "Taylor Example", email = "taylor@example.test") {
  await page.goto("/dashboard");
  await page.getByPlaceholder("MIND Test Case 001").fill(title);
  await page.getByPlaceholder("Taylor Example").fill(client);
  await page.getByPlaceholder("taylor@example.com").fill(email);
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByTestId("case-title")).toHaveText(title);
}

async function uploadPdf(page: Page, name = "agreement.pdf") {
  await page.getByTestId("pdf-input").setInputFiles({ name, mimeType: "application/pdf", buffer: await makeAgreementPdf(name) });
  await expect(page.getByTestId("pdf-page-3")).toBeVisible();
}

async function placeSignature(page: Page, pageIndex = 1, nx = 0.5, ny = 0.5) {
  await page.getByTestId("tool-signature").click();
  await clickOnPage(page, pageIndex, nx, ny);
}

/** Prepared case with one signature field on page 2; returns the signer URL. */
async function preparedLink(page: Page, title: string, client = "Taylor Example") {
  await createCase(page, title, client);
  await uploadPdf(page);
  await placeSignature(page);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.getByTestId("create-link").click();
  return page.getByTestId("signer-url").inputValue();
}

async function openAsSigner(browser: Browser, url: string) {
  const ctx = await browser.newContext();
  const signer = await ctx.newPage();
  await signer.goto(url);
  await expect(signer.getByTestId("pdf-page-2")).toBeVisible();
  await signer.getByTestId("sig-mode-type").click();
  await signer.getByTestId("consent").check();
  await expect(signer.getByTestId("submit-signature")).toBeEnabled();
  return { ctx, signer };
}

async function pdfText(bytes: Buffer, pageNo: number) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const tc = await (await doc.getPage(pageNo)).getTextContent();
  return (tc.items as { str: string }[]).map((i) => i.str).join(" ").replace(/\s+/g, " ");
}

test("case list: stages, next steps, accent-insensitive search, status filters, empty states", async ({ page }) => {
  const csp: string[] = [];
  watchCsp(page, csp);
  await openWorkspace(page);
  await expect(page.getByTestId("empty-cases")).toBeVisible();

  const seed = Date.now().toString(36);
  await createCase(page, `Draft ${seed}`, "Ana Núñez", "ana@example.test");
  await createCase(page, `Ready ${seed}`, "Bob Stone", "bob@example.test");
  await uploadPdf(page);
  await placeSignature(page);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await expect(page.getByTestId("status-badge")).toHaveText("Ready"); // refreshes when the first signature field is saved
  await createCase(page, `Pending ${seed}`, "Chen Wei", "chen@example.test");
  await uploadPdf(page);
  await placeSignature(page);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.getByTestId("create-link").click();
  await expect(page.getByTestId("status-badge")).toHaveText("Pending");

  await page.goto("/dashboard");
  const row = (t: string) => page.getByTestId("case-row").filter({ hasText: t });
  await expect(row(`Draft ${seed}`).getByTestId("status-badge")).toHaveText("Draft");
  await expect(row(`Ready ${seed}`).getByTestId("status-badge")).toHaveText("Ready");
  await expect(row(`Pending ${seed}`).getByTestId("status-badge")).toHaveText("Pending");
  await expect(row(`Draft ${seed}`)).toContainText("Upload the agreement PDF");
  await expect(row(`Ready ${seed}`)).toContainText("Create the signing link");

  await page.getByTestId("case-search").fill("nunez");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("case-row")).toHaveCount(1);
  await expect(page.getByTestId("case-row")).toContainText("Ana Núñez");

  await page.getByTestId("clear-filters").click();
  await expect(page).toHaveURL(/\/dashboard$/); // chips on the old page still carry q=nunez
  await expect(page.getByTestId("clear-filters")).toHaveCount(0);
  await page.getByTestId("filter-ready").click();
  await expect(page).toHaveURL(/status=ready/);
  await expect(page.getByTestId("case-row")).toHaveCount(1);
  await expect(page.getByTestId("case-row")).toContainText(`Ready ${seed}`);

  await page.goto("/dashboard?q=no-such-case-xyz");
  await expect(page.getByTestId("empty-filter")).toBeVisible();
  expect(csp).toEqual([]);
});

test("replacing a PDF with placed fields asks first; cancel keeps the fields", async ({ page }) => {
  await openWorkspace(page);
  await createCase(page, "Replace confirm");
  await uploadPdf(page, "first.pdf");
  await placeSignature(page);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.reload();
  const replaceInput = page.locator("label", { hasText: "Replace PDF" }).locator('input[type="file"]');
  const second = { name: "second.pdf", mimeType: "application/pdf", buffer: await makeAgreementPdf("second") };

  await replaceInput.setInputFiles(second);
  await expect(page.getByTestId("replace-confirm")).toContainText("second.pdf");
  await page.getByTestId("replace-confirm-no").click();
  await expect(page.getByTestId("replace-confirm")).toBeHidden();
  await expect(page.getByTestId("placed-field")).toHaveCount(1);
  await expect(page.getByTestId("document-meta")).toContainText("first.pdf");

  await replaceInput.setInputFiles(second);
  await page.getByTestId("replace-confirm-yes").click();
  await expect(page.getByTestId("document-meta")).toContainText("second.pdf");
  await expect(page.getByTestId("placed-field")).toHaveCount(0);
});

test("unsaved field changes: failed save is visible, in-app navigation asks, retry recovers", async ({ page }) => {
  await openWorkspace(page);
  await createCase(page, "Save failure");
  await uploadPdf(page);
  await page.route("**/api/requests/*/fields", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Service temporarily unavailable" }) }),
  );
  await placeSignature(page);
  await expect(page.getByTestId("save-state")).toHaveText("Not saved");
  await expect(page.getByText("Service temporarily unavailable")).toBeVisible();

  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.getByRole("link", { name: "← All cases" }).click();
  await expect.poll(() => asked).toContain("could not be saved");
  await expect(page.getByTestId("case-title")).toBeVisible(); // stayed

  await page.unroute("**/api/requests/*/fields");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.getByRole("link", { name: "← All cases" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("case-row").filter({ hasText: "Save failure" }).getByTestId("status-badge")).toHaveText("Ready");
});

test("two signature fields + long Unicode name: both stamped, name printed as typed", async ({ page, browser }) => {
  const csp: string[] = [];
  watchCsp(page, csp);
  await openWorkspace(page);
  await createCase(page, "Multi-signature Unicode");
  await uploadPdf(page);
  await placeSignature(page, 0, 0.5, 0.85);
  await placeSignature(page, 1, 320 / 595.28, (841.89 - 438) / 841.89);
  await page.getByTestId("tool-name").click();
  await clickOnPage(page, 1, 320 / 595.28, (841.89 - 480) / 841.89);
  await expect(page.getByTestId("placed-field")).toHaveCount(3);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.getByTestId("create-link").click();
  const url = await page.getByTestId("signer-url").inputValue();

  const name = "李小龍 Łukasz Đặng-Nguyễn Fernández de la Peña";
  const ctx = await browser.newContext();
  const signer = await ctx.newPage();
  watchCsp(signer, csp);
  await signer.goto(url);
  await expect(signer.locator('[data-testid="signer-field"][data-kind="signature"]')).toHaveCount(2);
  await signer.getByTestId("signer-name").fill(name);
  await signer.getByTestId("sig-mode-type").click();
  await signer.getByTestId("consent").check();
  await signer.getByTestId("submit-signature").click();
  await expect(signer.getByTestId("signing-complete")).toBeVisible();
  await ctx.close();

  await page.reload();
  await expect(page.getByTestId("status-badge")).toHaveText("Completed");
  const href = await page.getByTestId("download-signed").getAttribute("href");
  const signed = Buffer.from(await (await page.request.get(href!)).body());
  // pdf.js splits text items where the font changes, so compare without whitespace.
  const squash = (t: string) => t.replace(/\s+/g, "");
  expect(squash(await pdfText(signed, 2))).toContain(squash(name));
  expect(squash(await pdfText(signed, 4))).toContain(squash(name)); // certificate
  expect(await pdfText(signed, 2)).not.toContain("?");
  expect(csp).toEqual([]);
});

test("dropped connection before the server: nothing signed, clear message, retry succeeds", async ({ page, browser }) => {
  await openWorkspace(page);
  const url = await preparedLink(page, "Network drop (request)");
  const { ctx, signer } = await openAsSigner(browser, url);
  await signer.route("**/api/sign/submit", (route) => route.abort("internetdisconnected"));
  await signer.getByTestId("submit-signature").click();
  await expect(signer.getByTestId("sign-error")).toContainText("nothing was signed");
  await signer.unroute("**/api/sign/submit");
  await signer.getByTestId("submit-signature").click();
  await expect(signer.getByTestId("signing-complete")).toBeVisible();
  await ctx.close();
});

test("dropped connection after the server signed: signer sees completion, exactly one signature recorded", async ({ page, browser }) => {
  await openWorkspace(page);
  const url = await preparedLink(page, "Network drop (response)");
  const caseUrl = page.url();
  const { ctx, signer } = await openAsSigner(browser, url);
  await signer.route("**/api/sign/submit", async (route) => {
    await route.fetch(); // the server receives and commits the signature…
    await route.abort("internetdisconnected"); // …but the browser never sees the response
  });
  await signer.getByTestId("submit-signature").click();
  await expect(signer.getByTestId("signing-complete")).toBeVisible();

  // A second submission (double submit / retry) is refused.
  const token = url.split("#")[1]!;
  const again = await ctx.request.post("/api/sign/submit", {
    headers: { "x-signing-token": token },
    data: { consent: true, signerName: "Taylor Example", method: "typed", signaturePng: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAAgAAQ3cs1YAAAAASUVORK5CYII=" },
  });
  expect(again.status()).toBe(409);
  await ctx.close();

  await page.goto(caseUrl);
  await expect(page.getByTestId("status-badge")).toHaveText("Completed");
  await expect(page.locator('[data-event="document_signed"]')).toHaveCount(1);
  await expect(page.locator('[data-event="signing_attempt_rejected"]')).toContainText("already signed");
});
