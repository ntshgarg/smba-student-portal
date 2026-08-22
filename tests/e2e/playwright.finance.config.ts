import { defineConfig } from "@playwright/test"

function financeBaseUrl() {
  const url = new URL(process.env.SMBA_FINANCE_BASE_URL ?? "http://127.0.0.1:3102")
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "3102"
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SMBA finance regression must use http://127.0.0.1:3102.")
  }
  return url.origin
}

export default defineConfig({
  expect: { timeout: 12_000 },
  forbidOnly: true,
  fullyParallel: false,
  reporter: [["list"]],
  retries: 0,
  testDir: ".",
  testMatch: "finance-workflow.spec.ts",
  timeout: 120_000,
  use: {
    baseURL: financeBaseUrl(),
    colorScheme: "light",
    headless: true,
    locale: "en-IN",
    screenshot: "off",
    timezoneId: "Asia/Kolkata",
    trace: "off",
    video: "off",
    viewport: { height: 900, width: 1440 },
  },
  workers: 1,
})
