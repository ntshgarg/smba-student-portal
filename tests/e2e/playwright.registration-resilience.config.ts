import path from "node:path"

import { defineConfig } from "@playwright/test"

const baseURL = process.env.SMBA_REGISTRATION_RESILIENCE_BASE_URL

if (!baseURL) {
  throw new Error(
    "SMBA_REGISTRATION_RESILIENCE_BASE_URL is required. Start the production server externally against a disposable Clean clone.",
  )
}

const target = new URL(baseURL)
if (!["127.0.0.1", "localhost"].includes(target.hostname)) {
  throw new Error("Registration resilience tests may target only a loopback server.")
}
if (!target.port || target.port === "3000") {
  throw new Error(
    "Registration resilience tests require an explicit non-default port; port 3000 is reserved for normal local use.",
  )
}

export default defineConfig({
  expect: {
    timeout: 15_000,
  },
  forbidOnly: true,
  fullyParallel: false,
  globalSetup: path.resolve("tests/e2e/registration-resilience.global-setup.ts"),
  outputDir: path.resolve("output/registration-resilience/playwright-artifacts"),
  preserveOutput: "always",
  reporter: [["list"]],
  retries: 0,
  testDir: ".",
  testMatch: "registration-resilience.spec.ts",
  timeout: 90_000,
  use: {
    baseURL,
    colorScheme: "light",
    locale: "en-IN",
    screenshot: "off",
    timezoneId: "Asia/Kolkata",
    trace: "off",
    video: "off",
    viewport: { height: 844, width: 390 },
  },
  workers: 1,
})
