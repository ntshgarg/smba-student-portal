import path from "node:path"

import { defineConfig } from "@playwright/test"

const disposableDatabase = process.env.SMBA_PHASE8_DISPOSABLE_DB
if (!disposableDatabase || !path.resolve(disposableDatabase).startsWith("/private/tmp/")) {
  throw new Error("SMBA_PHASE8_DISPOSABLE_DB must identify a disposable /private/tmp database clone.")
}

export default defineConfig({
  expect: { timeout: 12_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: path.resolve("output/runtime-regression/phase-8-followup/playwright-artifacts"),
  reporter: [["list"]],
  retries: 0,
  testDir: ".",
  testMatch: "phase8-followup.spec.ts",
  timeout: 90_000,
  use: {
    baseURL: process.env.SMBA_PHASE8_BASE_URL ?? "http://127.0.0.1:3100",
    channel: "chrome",
    colorScheme: "light",
    locale: "en-IN",
    screenshot: "only-on-failure",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    video: "off",
  },
  workers: 1,
})
