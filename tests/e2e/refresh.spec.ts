/**
 * Refresh behaviour in the field editor (follow-up to the Firefox NS_BINDING_ABORTED race fixed in
 * #5). Simulates a user who: places a signature field, waits for the visible Saved/Ready state,
 * refreshes normally, finds the field in the same place, then creates the link and signs. Also
 * refreshes while a save is still pending and checks the UI never claims the field was saved.
 */
import { expect, test, type Page } from "@playwright/test";
import { makeAgreementPdf } from "./make-pdf";

async function clickOnPage(page: Page, pageIndex: number, nx: number, ny: number) {
  const overlay = page.locator(`[data-page-overlay="${pageIndex}"]`);
  await overlay.scrollIntoViewIfNeeded();
  const box = (await overlay.boundingBox())!;
  await overlay.click({ position: { x: box.width * nx, y: box.height * ny }, timeout: 10_000 });
}

async function newCaseWithPdf(page: Page, title: string) {
  await page.goto("/");
  await page.getByTestId("enter-demo").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByPlaceholder("MIND Test Case 001").fill(title);
  await page.getByPlaceholder("Taylor Example").fill("Taylor Example");
  await page.getByPlaceholder("taylor@example.com").fill("taylor@example.test");
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByTestId("case-title")).toHaveText(title);
  await page.getByTestId("pdf-input").setInputFiles({ name: "agreement.pdf", mimeType: "application/pdf", buffer: await makeAgreementPdf(title) });
  await expect(page.getByTestId("pdf-page-3")).toBeVisible();
}

/** Field position relative to its page overlay, as fractions (independent of scroll). */
async function fieldPosition(page: Page) {
  const field = page.locator('[data-testid="placed-field"][data-page="2"][data-kind="signature"]');
  await expect(field).toHaveCount(1);
  await field.scrollIntoViewIfNeeded();
  const f = (await field.boundingBox())!;
  const o = (await page.locator('[data-page-overlay="1"]').boundingBox())!;
  return { x: (f.x - o.x) / o.width, y: (f.y - o.y) / o.height, w: f.width / o.width, h: f.height / o.height };
}

test("refresh after the visible Saved/Ready state keeps the field in place; link and signing still work", async ({ page, browser }) => {
  await newCaseWithPdf(page, `Refresh ${Date.now().toString(36)}`);
  await page.getByTestId("tool-signature").click();
  await clickOnPage(page, 1, 0.4, 0.6);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await expect(page.getByTestId("status-badge")).toHaveText("Ready");
  const before = await fieldPosition(page);

  await page.reload();
  await expect(page.getByTestId("status-badge")).toHaveText("Ready");
  const after = await fieldPosition(page);
  for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(after[k] - before[k])).toBeLessThan(0.005);

  await page.getByTestId("create-link").click();
  const url = await page.getByTestId("signer-url").inputValue();
  await expect(page.getByTestId("status-badge")).toHaveText("Pending");

  const ctx = await browser.newContext();
  const signer = await ctx.newPage();
  await signer.goto(url);
  await expect(signer.getByTestId("pdf-page-2")).toBeVisible();
  await signer.getByTestId("sig-mode-type").click();
  await signer.getByTestId("consent").check();
  await signer.getByTestId("submit-signature").click();
  await expect(signer.getByTestId("signing-complete")).toBeVisible();
  await ctx.close();

  await page.reload();
  await expect(page.getByTestId("status-badge")).toHaveText("Completed");
});

test("refresh while a save is still pending: never shows Saved, warns before leaving, and shows only what the server stored", async ({ page }) => {
  await newCaseWithPdf(page, `Pending save ${Date.now().toString(36)}`);
  // Hold the field save in flight so the refresh happens while it is pending.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/requests/*/fields", async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.dismiss(); // the user chooses "Stay on page"
  });

  await page.getByTestId("tool-signature").click();
  await clickOnPage(page, 1, 0.4, 0.6);
  await expect(page.getByTestId("save-state")).toHaveText("Saving…");

  // Refresh while pending: the browser asks first; staying keeps the page and the pending save.
  await page.reload({ timeout: 3_000 }).catch(() => {});
  expect(dialogs).toContain("beforeunload");
  await expect(page.getByTestId("save-state")).not.toHaveText("Saved");

  release();
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await expect(page.getByTestId("status-badge")).toHaveText("Ready");
  await page.unroute("**/api/requests/*/fields");
  await page.reload();
  await expect(page.locator('[data-testid="placed-field"][data-page="2"]')).toHaveCount(1);
});

test("leaving anyway while a save is pending: the reloaded page shows the server's state, not a false Saved", async ({ page }) => {
  await newCaseWithPdf(page, `Leave anyway ${Date.now().toString(36)}`);
  await page.route("**/api/requests/*/fields", () => {
    /* never answered: the save is lost with the page */
  });
  page.on("dialog", (d) => void d.accept()); // the user chooses "Leave page"

  await page.getByTestId("tool-signature").click();
  await clickOnPage(page, 1, 0.4, 0.6);
  await expect(page.getByTestId("save-state")).toHaveText("Saving…");
  await page.reload();
  await expect(page.getByTestId("pdf-page-3")).toBeVisible();
  // Nothing reached the server, so nothing is shown as placed and the case is still Draft.
  await expect(page.getByTestId("placed-field")).toHaveCount(0);
  await expect(page.getByTestId("status-badge")).toHaveText("Draft");
  await expect(page.getByTestId("save-state")).not.toHaveText("Saved");
});
