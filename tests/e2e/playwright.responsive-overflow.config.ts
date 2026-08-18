import path from "node:path"

import { defineConfig } from "@playwright/test"

export default defineConfig({
  expect: {
    timeout: 12_000,
  },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: path.resolve("output/responsive-overflow/playwright-artifacts"),
  reporter: [["list"]],
  retries: 0,
  testDir: ".",
  testMatch: [
    "accessibility-hardening.spec.ts",
    "authentication-responsive.spec.ts",
    "phase3c-interface-correctness.spec.ts",
    "responsive-overflow.spec.ts",
  ],
  timeout: 120_000,
  use: {
    baseURL: process.env.SMBA_RESPONSIVE_OVERFLOW_BASE_URL ?? "http://127.0.0.1:3000",
    channel: "chrome",
    colorScheme: "light",
    locale: "en-IN",
    screenshot: "only-on-failure",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    video: "off",
    viewport: { height: 844, width: 390 },
  },
  workers: 1,
})
