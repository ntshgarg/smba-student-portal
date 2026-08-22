import path from "node:path"

import { defineConfig } from "@playwright/test"

export default defineConfig({
  expect: {
    timeout: 12_000,
  },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: path.resolve("output/attendance-workspaces-smoke/playwright-artifacts"),
  reporter: [["list"]],
  retries: 0,
  testDir: ".",
  testMatch: "attendance-workspaces.spec.ts",
  timeout: 90_000,
  use: {
    baseURL: process.env.SMBA_ATTENDANCE_WORKSPACES_BASE_URL ?? "http://localhost:3000",
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
