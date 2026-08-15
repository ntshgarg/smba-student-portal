import path from "node:path"
import { defineConfig } from "@playwright/test"

export default defineConfig({
  expect: { timeout: 12_000 },
  forbidOnly: true,
  outputDir: path.resolve("output/onboarding-register/playwright-artifacts"),
  reporter: [["list"]],
  retries: 0,
  testDir: ".",
  testMatch: "onboarding-register.spec.ts",
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    colorScheme: "light",
    headless: true,
    locale: "en-IN",
    screenshot: "only-on-failure",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    video: "off",
  },
  workers: 1,
})
