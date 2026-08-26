import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

const repositoryRoot = path.resolve(import.meta.dirname, "..")

// Two spellings of the same idea, because the guard under test used to accept
// only one of them: os.tmpdir() is /var/folders/<hash>/T on macOS and /tmp on
// the ubuntu-24.04 runner, while a literal /tmp path is what every workflow step
// in .github/workflows/quality.yml writes its disposable clones to.
const privateTemporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-phase8-"))
const sharedTemporaryDirectory = fs.mkdtempSync(path.join("/tmp", "smba-phase8-"))
const privateDatabase = path.join(privateTemporaryDirectory, "academy-stress.db")
const sharedDatabase = path.join(sharedTemporaryDirectory, "academy-stress.db")
fs.writeFileSync(privateDatabase, "")
fs.writeFileSync(sharedDatabase, "")

// Both guards run while the module body evaluates, so the only way to observe
// one is to import the config again under a different environment.
async function importPhase8Config(database: string) {
  vi.resetModules()
  vi.stubEnv("SMBA_PHASE8_DISPOSABLE_DB", database)
  return (await import("@/tests/e2e/playwright.phase8-followup.config")).default
}

async function importResponsiveOverflowConfig() {
  vi.resetModules()
  return (await import("@/tests/e2e/playwright.responsive-overflow.config")).default
}

async function importAuthenticationConfig() {
  vi.resetModules()
  return (await import("@/tests/e2e/playwright.authentication.config")).default
}

function matchedSpecs(testMatch: unknown) {
  const entries = Array.isArray(testMatch) ? testMatch : [testMatch]
  return entries.filter((entry): entry is string => typeof entry === "string")
}

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(() => {
  fs.rmSync(privateTemporaryDirectory, { force: true, recursive: true })
  fs.rmSync(sharedTemporaryDirectory, { force: true, recursive: true })
})

describe("phase 8 follow-up disposable database guard", () => {
  it("accepts a clone under the temporary directory this platform reports", async () => {
    const config = await importPhase8Config(privateDatabase)

    expect(config.testMatch).toBe("phase8-followup.spec.ts")
  })

  it("accepts the /tmp clone every quality.yml step actually produces", async () => {
    const config = await importPhase8Config(sharedDatabase)

    expect(config.testMatch).toBe("phase8-followup.spec.ts")
  })

  it("refuses a path that names no file, because a clone has to exist", async () => {
    await expect(importPhase8Config(path.join(privateTemporaryDirectory, "absent.db")))
      .rejects.toThrow(/existing disposable database clone/u)
  })

  it("refuses a database inside the repository whatever TMPDIR claims", async () => {
    vi.stubEnv("TMPDIR", repositoryRoot)

    await expect(importPhase8Config(path.join(repositoryRoot, "package.json")))
      .rejects.toThrow(/outside the repository/u)
  })

  it("refuses to run at all when no database is named", async () => {
    await expect(importPhase8Config("")).rejects.toThrow(/SMBA_PHASE8_DISPOSABLE_DB/u)
  })
})

describe("browser channel selection", () => {
  it("leaves both suites on the bundled build the workflows install", async () => {
    const phase8 = await importPhase8Config(privateDatabase)
    const responsiveOverflow = await importResponsiveOverflowConfig()

    expect(phase8.use?.channel).toBeUndefined()
    expect(responsiveOverflow.use?.channel).toBeUndefined()
  })

  it("still lets an operator name an installed channel through the environment", async () => {
    vi.stubEnv("SMBA_PHASE8_BROWSER_CHANNEL", "chrome")
    vi.stubEnv("SMBA_RESPONSIVE_OVERFLOW_BROWSER_CHANNEL", "chrome")

    const phase8 = await importPhase8Config(privateDatabase)
    const responsiveOverflow = await importResponsiveOverflowConfig()

    expect(phase8.use?.channel).toBe("chrome")
    expect(responsiveOverflow.use?.channel).toBe("chrome")
  })
})

describe("responsive overflow scheduling", () => {
  it("keeps the three specs no other configuration claims", async () => {
    const responsiveOverflow = await importResponsiveOverflowConfig()

    expect(matchedSpecs(responsiveOverflow.testMatch)).toEqual(expect.arrayContaining([
      "accessibility-hardening.spec.ts",
      "phase3c-interface-correctness.spec.ts",
      "responsive-overflow.spec.ts",
    ]))
  })

  it("leaves authentication-responsive.spec.ts to the suite that already gates it", async () => {
    const responsiveOverflow = await importResponsiveOverflowConfig()
    const authentication = await importAuthenticationConfig()
    const alreadyGated = new Set(matchedSpecs(authentication.testMatch))

    expect(alreadyGated.has("authentication-responsive.spec.ts")).toBe(true)
    expect(matchedSpecs(responsiveOverflow.testMatch).filter((spec) => alreadyGated.has(spec)))
      .toEqual([])
  })
})
