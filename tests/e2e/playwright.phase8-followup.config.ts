import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { defineConfig } from "@playwright/test"

function realPath(candidate: string) {
  try {
    return fs.realpathSync(candidate)
  } catch {
    return null
  }
}

/*
 * phase8-followup.spec.ts publishes a real announcement, so this suite may only
 * ever be aimed at a throwaway clone. The guard below demanded a literal
 * "/private/tmp/" prefix, which is only how macOS spells the real path behind
 * /tmp: on ubuntu-24.04 os.tmpdir() is "/tmp" and /private does not exist at
 * all, so no path a workflow could legitimately produce satisfied it and the
 * config threw before Playwright collected a single test. Comparing real paths
 * against every temporary root this platform actually has keeps the purpose and
 * tightens it twice over -- fs.realpathSync resolves a symlink planted in /tmp
 * that points at a database somewhere else, and it returns null for a path that
 * does not exist, so "a disposable clone" now has to be a file that is there.
 */
const disposableRoots = [...new Set([os.tmpdir(), "/tmp"])]
  .map(realPath)
  .filter((root): root is string => root !== null)
  .map((root) => (root.endsWith(path.sep) ? root : root + path.sep))

// Widening from one hard-coded prefix to os.tmpdir() hands TMPDIR a say in what
// counts as disposable, and .data/academy-*.db is exactly the database this
// suite must never write to. The repository stays out of bounds whatever TMPDIR
// says, including when the checkout itself sits under a temporary root.
const repositoryRoot = realPath(process.cwd())

function isDisposableDatabase(database: string) {
  if (repositoryRoot && database.startsWith(repositoryRoot + path.sep)) return false
  return disposableRoots.some((root) => database.startsWith(root))
}

const requestedDatabase = process.env.SMBA_PHASE8_DISPOSABLE_DB
const disposableDatabase = requestedDatabase ? realPath(requestedDatabase) : null
if (!disposableDatabase || !isDisposableDatabase(disposableDatabase)) {
  throw new Error(
    "SMBA_PHASE8_DISPOSABLE_DB must identify an existing disposable database clone"
    + ` inside ${disposableRoots.join(" or ")} and outside the repository.`,
  )
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
    // Never pin a channel here. Both workflows install the bundled build with
    // `npx playwright install --with-deps chromium` and nothing installs the
    // Google Chrome stable that channel: "chrome" resolves to, so the pin named
    // a browser the pipeline does not have. playwright.accessibility.config.ts
    // takes the same value from the environment; this follows it.
    channel: process.env.SMBA_PHASE8_BROWSER_CHANNEL || undefined,
    colorScheme: "light",
    locale: "en-IN",
    // Nothing raw, for the reason spelled out in
    // playwright.responsive-overflow.config.ts: outputDir is not on the browser
    // job's upload list and cannot be, so a trace of the announcement this
    // suite publishes -- POST body, cookie, DOM -- would be written to a runner
    // that is discarded before anyone could fetch it. The spec stages masked
    // evidence instead.
    screenshot: "off",
    timezoneId: "Asia/Kolkata",
    trace: "off",
    video: "off",
  },
  workers: 1,
})
