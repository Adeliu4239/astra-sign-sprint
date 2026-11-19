import { expect, test, type Browser, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { makeAgreementPdf } from "./make-pdf";
import { signatureImageRect } from "../support/pdf-inspect";

async function clickOnPage(page: Page, pageIndex: number, nx: number, ny: number) {
  const overlay = page.locator(`[data-page-overlay="${pageIndex}"]`);
  await overlay.scrollIntoViewIfNeeded();
  const box = (await overlay.boundingBox())!;
  await overlay.click({ position: { x: box.width * nx, y: box.height * ny }, timeout: 10_000 });
}

async function createCaseFromForm(page: Page, title: string, templateId: string) {
  await page.goto("/dashboard");
  await page.getByPlaceholder("MIND Test Case 001").fill(title);
  await page.getByPlaceholder("Taylor Example").fill("Taylor Example");
  await page.getByPlaceholder("taylor@example.com").fill("taylor@example.com");
  await page.getByTestId("template-select").selectOption(templateId);
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByTestId("case-title")).toHaveText(title);
  return page.url();
}

/** Issues the link from the case page and signs it in a separate, cookie-less context. Returns the signed PDF. */
async function sendAndSign(page: Page, browser: Browser, caseUrl: string) {
  await page.goto(caseUrl);
  await page.getByTestId("create-link").click();
  const signerUrl = await page.getByTestId("signer-url").inputValue();
  const ctx = await browser.newContext();
  const signer = await ctx.newPage();
  await signer.goto(signerUrl);
  await expect(signer.getByTestId("pdf-page-2")).toBeVisible();
  await signer.getByTestId("sig-mode-type").click();
  await signer.getByTestId("consent").check();
  await signer.getByTestId("submit-signature").click();
  await expect(signer.getByTestId("signing-complete")).toBeVisible();
  await ctx.close();
  await page.goto(caseUrl);
  await expect(page.getByTestId("status-badge")).toHaveText("Completed");
  const href = await page.getByTestId("download-signed").getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  return { bytes: new Uint8Array(await res.body()), href: href! };
}

test("reusable template: save once, create two independent cases, sign both; template edits and deletion don't leak", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const seed = `tpl-${Date.now().toString(36)}`;
  const pdf = await makeAgreementPdf(seed);

  await page.goto("/");
  await page.getByTestId("enter-demo").click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // 1. Create a template and upload an unseen PDF.
  await page.getByRole("link", { name: "Templates", exact: true }).click();
  await page.getByPlaceholder("Standard client agreement").fill(`Standard agreement ${seed}`);
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByTestId("template-title")).toHaveText(`Standard agreement ${seed}`);
  const templateUrl = page.url();
  const templateId = templateUrl.split("/templates/")[1]!;
  await page.getByTestId("pdf-input").setInputFiles({ name: `standard-${seed}.pdf`, mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByTestId("document-meta")).toContainText("3 pages");
  await expect(page.getByTestId("template-note")).toBeVisible();
  await expect(page.getByTestId("create-link")).toHaveCount(0); // templates are never sent

  // 2. Place signature on page 2's line and a date on page 3; it autosaves and survives refresh.
  await page.getByTestId("tool-signature").click();
  await clickOnPage(page, 1, 320 / 595.28, (841.89 - 438) / 841.89);
  await page.getByTestId("tool-date").click();
  await clickOnPage(page, 2, 0.7, 0.2);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await expect(page.getByTestId("use-template")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("placed-field")).toHaveCount(2);

  // 3. Isolation: another workspace can't see or use it.
  const other = await browser.newContext();
  const op = await other.newPage();
  await op.goto("/");
  await op.getByTestId("enter-demo").click();
  await expect(op).toHaveURL(/\/dashboard$/);
  expect((await op.goto(templateUrl))!.status()).toBe(404);
  const steal = await op.request.post("/api/cases", { data: { title: "x", clientName: "x", clientEmail: "x@example.test", templateId } });
  expect(steal.status()).toBe(404);
  await op.goto("/templates");
  await expect(op.getByTestId("template-row")).toHaveCount(0);
  await other.close();

  // 4. Two cases from the template, created from the dashboard form.
  await page.getByTestId("use-template").click();
  await expect(page.getByTestId("template-select")).toHaveValue(templateId);
  const caseA = await createCaseFromForm(page, `Client A ${seed}`, templateId);
  await expect(page.getByTestId("from-template")).toContainText(`Standard agreement ${seed}`);
  await expect(page.getByTestId("document-meta")).toContainText("3 pages");
  await expect(page.getByTestId("placed-field")).toHaveCount(2);
  const caseB = await createCaseFromForm(page, `Client B ${seed}`, templateId);
  await expect(page.getByTestId("placed-field")).toHaveCount(2);

  // 5. Edit the template (remove the date field): existing cases keep both fields.
  await page.goto(templateUrl);
  await expect(page.getByTestId("template-usage")).toContainText("Used by 2 cases");
  await page.locator('[data-testid="placed-field"][data-kind="date"]').click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("placed-field")).toHaveCount(1);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("placed-field")).toHaveCount(1);
  await page.goto(caseA);
  await expect(page.getByTestId("placed-field")).toHaveCount(2);

  // 6. Sign case A.
  const a = await sendAndSign(page, browser, caseA);

  // 7. Delete the template, then sign case B: it still has its own copy.
  await page.goto(templateUrl);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("delete-template").click();
  await expect(page).toHaveURL(/\/templates$/);
  await expect(page.getByTestId("template-row")).toHaveCount(0);
  await page.goto(caseB);
  await expect(page.getByTestId("placed-field")).toHaveCount(2);
  const b = await sendAndSign(page, browser, caseB);

  // 8. Independent, correctly stamped artifacts.
  expect(a.href).not.toBe(b.href);
  for (const signed of [a.bytes, b.bytes]) {
    expect((await PDFDocument.load(signed)).getPageCount()).toBe(4);
    expect(await signatureImageRect(signed, 0)).toBeNull();
    const r = (await signatureImageRect(signed, 1))!;
    expect(r, "signature on page 2").not.toBeNull();
    expect(r.x).toBeGreaterThanOrEqual(229);
    expect(r.x + r.w).toBeLessThanOrEqual(411);
    expect(r.y).toBeGreaterThanOrEqual(412);
    expect(r.y + r.h).toBeLessThanOrEqual(464);
  }

  // 9. Dashboard shows both completed; the template never appears as a case.
  await page.goto("/dashboard");
  for (const t of [`Client A ${seed}`, `Client B ${seed}`]) {
    await expect(page.getByRole("row", { name: new RegExp(t) }).getByTestId("status-badge")).toHaveText("Completed");
  }
  await expect(page.getByRole("row", { name: new RegExp(`Standard agreement ${seed}`) })).toHaveCount(0);
});
