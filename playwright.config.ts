import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const isRemote = !!process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    // Signing URLs are secrets: keep traces/videos off so they never land in artifacts.
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  // E2E_BROWSERS=chromium,firefox,webkit to run more engines (default: chromium).
  projects: (process.env.E2E_BROWSERS ?? "chromium").split(",").map((b) => {
    const device = { chromium: "Desktop Chrome", firefox: "Desktop Firefox", webkit: "Desktop Safari" }[b.trim()] ?? "Desktop Chrome";
    return { name: b.trim(), use: { ...devices[device] } };
  }),
  webServer: isRemote
    ? undefined
    : { command: "npm run dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
