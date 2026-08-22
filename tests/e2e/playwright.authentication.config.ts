import { defineConfig } from "@playwright/test"

export default defineConfig({
  expect: { timeout: 12_000 },
  forbidOnly: true,
  fullyParallel: false,
  reporter: [["list"]],
  retries: 0,
  testDir: ".",
  testMatch: "authentication-responsive.spec.ts",
  timeout: 60_000,
  use: {
    baseURL: process.env.SMBA_E2E_BASE_URL ?? "http://localhost:3000",
    colorScheme: "light",
    headless: true,
    locale: "en-IN",
    screenshot: "off",
    timezoneId: "Asia/Kolkata",
    trace: "off",
    video: "off",
  },
  workers: 1,
})
