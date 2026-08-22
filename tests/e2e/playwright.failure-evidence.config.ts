import path from "node:path"

import { defineConfig } from "@playwright/test"

export default defineConfig({
  forbidOnly: true,
  outputDir: path.join("/tmp", "smba-failure-evidence-sentinel-playwright"),
  preserveOutput: "never",
  reporter: [["list"]],
  retries: 0,
  testDir: ".",
  testMatch: "failure-evidence-sentinel.spec.ts",
  timeout: 30_000,
  use: {
    headless: true,
    screenshot: "off",
    trace: "off",
    video: "off",
    viewport: { height: 844, width: 390 },
  },
  workers: 1,
})
