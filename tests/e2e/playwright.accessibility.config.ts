import path from "node:path"

import { defineConfig } from "@playwright/test"

const profile = process.env.SMBA_ACCESSIBILITY_PROFILE ?? "stress"
const outputRoot = path.resolve(
  process.env.SMBA_ACCESSIBILITY_OUTPUT_DIR ?? "output/accessibility",
  profile,
)

export default defineConfig({
  expect: { timeout: 12_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: path.join(outputRoot, "playwright-artifacts"),
  preserveOutput: "always",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(outputRoot, "html-report") }],
  ],
  retries: 0,
  testDir: ".",
  testMatch: [
    "accessibility-regression.spec.ts",
    "accessibility-sentinel.spec.ts",
  ],
  timeout: 20 * 60_000,
  use: {
    actionTimeout: 20_000,
    baseURL: process.env.SMBA_ACCESSIBILITY_BASE_URL ?? "http://127.0.0.1:3000",
    channel: process.env.SMBA_ACCESSIBILITY_BROWSER_CHANNEL || undefined,
    colorScheme: "light",
    headless: true,
    locale: "en-IN",
    navigationTimeout: 20_000,
    screenshot: "off",
    timezoneId: "Asia/Kolkata",
    trace: "off",
    video: "off",
  },
  workers: 1,
})
