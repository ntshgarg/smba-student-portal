import path from "node:path"
import { defineConfig } from "@playwright/test"

import { captureSettings } from "./support/capture-settings"

export default defineConfig({
  expect: {
    timeout: 12_000,
  },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: path.join(captureSettings.runDir, "playwright-artifacts"),
  preserveOutput: "always",
  reporter: [["list"]],
  retries: 0,
  testDir: ".",
  testMatch: "capture-regression.spec.ts",
  timeout: 180_000,
  use: {
    baseURL: captureSettings.baseURL,
    channel: "chrome",
    colorScheme: "light",
    deviceScaleFactor: 1,
    headless: true,
    locale: "en-IN",
    screenshot: "off",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    video: "off",
  },
  workers: 1,
})
