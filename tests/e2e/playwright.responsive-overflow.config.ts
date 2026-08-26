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
  // authentication-responsive.spec.ts is deliberately absent. Its four cases
  // already gate through playwright.authentication.config.ts, and that suite
  // sets its own 1440/820/390 viewports per case, so running it a second time
  // under the 390x844 default below repeats the same three measurements rather
  // than adding a fourth.
  testMatch: [
    "accessibility-hardening.spec.ts",
    "phase3c-interface-correctness.spec.ts",
    "responsive-overflow.spec.ts",
  ],
  timeout: 120_000,
  use: {
    baseURL: process.env.SMBA_RESPONSIVE_OVERFLOW_BASE_URL ?? "http://127.0.0.1:3000",
    // Never pin a channel here. Both workflows install the bundled build with
    // `npx playwright install --with-deps chromium` and nothing installs the
    // Google Chrome stable that channel: "chrome" resolves to, so the pin named
    // a browser the pipeline does not have. playwright.accessibility.config.ts
    // takes the same value from the environment; this follows it.
    channel: process.env.SMBA_RESPONSIVE_OVERFLOW_BROWSER_CHANNEL || undefined,
    colorScheme: "light",
    locale: "en-IN",
    // Nothing raw, now that this suite gates. A trace zip holds the login POST
    // body, the session cookie and the full DOM, and an only-on-failure
    // screenshot is unmasked; both are written to outputDir, which the browser
    // job's upload step does not list and which
    // tests/ci-diagnostics-controls.test.ts forbids it from listing. Retention
    // here wrote sensitive bytes nobody could fetch. The specs stage masked
    // screenshots and sanitized JSON under SMBA_FAILURE_EVIDENCE_ROOT instead,
    // which is the tree the job does upload.
    screenshot: "off",
    timezoneId: "Asia/Kolkata",
    trace: "off",
    video: "off",
    viewport: { height: 844, width: 390 },
  },
  workers: 1,
})
