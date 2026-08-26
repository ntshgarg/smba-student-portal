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
    // Never pin a channel here. Both workflows install the bundled build with
    // `npx playwright install --with-deps chromium` and nothing installs the
    // Google Chrome stable that channel: "chrome" resolves to, so this pin named
    // a browser no pipeline has -- which is part of why this suite has never run
    // anywhere but a developer's laptop. The other three configs already take it
    // from the environment; this follows them.
    channel: process.env.SMBA_CAPTURE_BROWSER_CHANNEL || undefined,
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
