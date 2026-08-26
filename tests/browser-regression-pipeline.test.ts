import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const repositoryRoot = path.resolve(import.meta.dirname, "..")
const e2eDirectory = path.join(repositoryRoot, "tests/e2e")
const workflowDirectory = path.join(repositoryRoot, ".github/workflows")

/*
 * The deliberate exceptions, each with the reason it is one. Everything else
 * under tests/e2e has to be reachable from a workflow. G-27 was 19 cases across
 * four specs that were not, sitting in the same directory as the specs that are,
 * and nothing in the repository said so -- which is the whole point of deriving
 * this from the directory listing rather than from a checked-in list of names.
 */
const manualOnlyConfigs = new Map([[
  "playwright.config.ts",
  "the authenticated capture harness produces screenshots and evidence JSON for a"
  + " person to read rather than a pass/fail signal (tests/e2e/README.md)",
]])
const manualOnlySpecs = new Map([[
  "capture-regression.spec.ts",
  "the only spec the capture harness schedules, manual for the same reason",
]])

// Some configs refuse to load without the environment their runner supplies.
// These values only have to satisfy the guards; nothing here starts a server.
const disposableDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-pipeline-"))
const disposableDatabase = path.join(disposableDirectory, "academy-stress.db")
fs.writeFileSync(disposableDatabase, "")

function readRepositoryFile(file: string) {
  return fs.readFileSync(path.join(repositoryRoot, file), "utf8")
}

const configFileNames = fs.readdirSync(e2eDirectory)
  .filter((entry) => entry.startsWith("playwright.") && entry.endsWith(".config.ts"))
  .sort()

const specFileNames = fs.readdirSync(e2eDirectory)
  .filter((entry) => entry.endsWith(".spec.ts"))
  .sort()

const packageScripts = (JSON.parse(readRepositoryFile("package.json")) as {
  scripts: Record<string, string>
}).scripts

const workflowSource = fs.readdirSync(workflowDirectory)
  .filter((entry) => entry.endsWith(".yml"))
  .map((entry) => fs.readFileSync(path.join(workflowDirectory, entry), "utf8"))
  .join("\n")

// `npm run regression:finance` is a prefix of `npm run regression:finance:prepare`,
// so a plain substring search would report a script as wired on the strength of a
// step that runs a different one.
function workflowRunsScript(name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  return new RegExp(`npm run ${escaped}(?![\\w:.-])`, "u").test(workflowSource)
}

function workflowRunsConfig(configFileName: string) {
  const configPath = `tests/e2e/${configFileName}`
  // quality.yml invokes the failure-evidence sentinel by path rather than through
  // a script, because it asserts the run fails.
  if (workflowSource.includes(configPath)) return true
  return Object.entries(packageScripts)
    .some(([name, command]) => command.includes(configPath) && workflowRunsScript(name))
}

function matchedSpecs(testMatch: unknown) {
  const entries = Array.isArray(testMatch) ? testMatch : [testMatch]
  return entries.filter((entry): entry is string => typeof entry === "string")
}

const scheduledSpecs = new Map<string, string[]>()

beforeAll(async () => {
  vi.stubEnv("SMBA_PHASE8_DISPOSABLE_DB", disposableDatabase)
  vi.stubEnv("SMBA_REGISTRATION_RESILIENCE_BASE_URL", "http://127.0.0.1:3101")

  for (const configFileName of configFileNames) {
    if (manualOnlyConfigs.has(configFileName)) continue
    const specifier = pathToFileURL(path.join(e2eDirectory, configFileName)).href
    const loaded = await import(/* @vite-ignore */ specifier) as {
      default: { testMatch?: unknown }
    }
    scheduledSpecs.set(configFileName, matchedSpecs(loaded.default.testMatch))
  }

  vi.unstubAllEnvs()
})

afterAll(() => {
  fs.rmSync(disposableDirectory, { force: true, recursive: true })
})

describe("browser regression pipeline coverage", () => {
  it("runs every Playwright configuration in a workflow, or records why not", () => {
    const unreachable = configFileNames.filter((configFileName) => (
      !manualOnlyConfigs.has(configFileName) && !workflowRunsConfig(configFileName)
    ))

    expect(unreachable).toEqual([])
  })

  it("schedules every end-to-end spec from a configuration a workflow runs", () => {
    const gated = new Set([...scheduledSpecs]
      .filter(([configFileName]) => workflowRunsConfig(configFileName))
      .flatMap(([, specs]) => specs))
    const orphaned = specFileNames.filter((spec) => (
      !manualOnlySpecs.has(spec) && !gated.has(spec)
    ))

    expect(orphaned).toEqual([])
  })

  it("never pays for the same spec twice across gating configurations", () => {
    const owners = new Map<string, string[]>()
    for (const [configFileName, specs] of scheduledSpecs) {
      if (!workflowRunsConfig(configFileName)) continue
      for (const spec of specs) {
        owners.set(spec, [...(owners.get(spec) ?? []), configFileName])
      }
    }
    const duplicated = [...owners].filter(([, configs]) => configs.length > 1)

    expect(duplicated).toEqual([])
  })
})
