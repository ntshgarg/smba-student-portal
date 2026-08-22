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
    baseURL: process.env.SMBA_ONBOARDING_BASE_URL ?? "http://localhost:3000",
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
