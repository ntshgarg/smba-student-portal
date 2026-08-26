import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { describe, expect, it, vi } from "vitest"

const repositoryRoot = path.resolve(import.meta.dirname, "..")
const e2eDirectory = path.join(repositoryRoot, "tests/e2e")

function readRepositoryFile(file: string) {
  return readFileSync(path.join(repositoryRoot, file), "utf8")
}

// Every step in these workflows begins at six spaces, so splitting before any
// six-space list item yields one string per step. Splitting on "- name: " alone
// would have absorbed an unnamed "- uses:" step -- GitHub's own idiomatic form --
// into the previous step's chunk. This split is only used to read one step's own
// keys; what actually rules out a second upload step is countUploadSteps below,
// which reads the whole file and does not depend on this regex.
function uploadArtifactSteps(workflow: string) {
  return workflow
    .split(/\n(?=      - )/u)
    .filter((step) => step.includes("uses: actions/upload-artifact"))
}

function countUploadSteps(workflow: string) {
  return (workflow.match(/uses: actions\/upload-artifact/gu) ?? []).length
}

function uploadedPaths(step: string) {
  const block = /\n          path: \|\n((?:            \S.*\n)+)/u.exec(step)
  return block ? block[1].trim().split("\n").map((line) => line.trim()) : []
}

// Both workflows have to be checked on their own file. Concatenating them let
// one workflow's `if: failure()` satisfy the assertion for the other, and
// ui-accessibility.yml does not contain that string at all: its three audit
// steps set continue-on-error: true so that all of them run, which leaves
// failure() false at the upload step. Its gate reads the recorded outcomes
// instead, and nothing was checking that until these were split apart.
const evidenceUploads = [
  {
    file: ".github/workflows/quality.yml",
    gate: "if: failure()",
    artifact: "name: browser-failure-${{ github.run_id }}-${{ github.run_attempt }}",
    paths: [
      "output/failure-evidence/**/*.masked.png",
      "output/failure-evidence/**/*.sanitized.json",
      "output/failure-evidence/**/*.sanitized.txt",
    ],
  },
  {
    file: ".github/workflows/ui-accessibility.yml",
    gate: "if: always() && (steps.admin.outcome == 'failure'"
      + " || steps.clean.outcome == 'failure'"
      + " || steps.stress.outcome == 'failure'"
      + " || steps.summary.outcome == 'failure')",
    artifact: "name: ui-accessibility-failure-${{ github.run_id }}-${{ github.run_attempt }}",
    paths: [
      "output/failure-evidence/**/*.masked.png",
      "output/failure-evidence/**/*.sanitized.json",
      "output/failure-evidence/**/*.sanitized.txt",
      "output/accessibility/**/results.sanitized.json",
      "output/accessibility/**/summary.sanitized.txt",
      // The third file writeAccessibilityResults produces: the academy date the
      // run rendered at, a bare date string beside the counts it explains.
      // update-accessibility-advisory-baseline.ts refuses to record a profile
      // without it, so an artifact holding the counts alone is one no operator
      // can re-record from, and the gate's only remaining remedy would be a
      // local fixture build, `npm run build` and Playwright run.
      "output/accessibility/**/fixture-clock.sanitized.json",
    ],
  },
]

describe("CI failure diagnostics and deployment verification", () => {
  it("uploads only allowlisted sanitized evidence on failure in each workflow", () => {
    for (const { file, gate, artifact, paths } of evidenceUploads) {
      const workflow = readRepositoryFile(file)
      const steps = uploadArtifactSteps(workflow)

      // Counted over the whole file first. Without this, a second upload step
      // could carry raw evidence past the allowlist below simply by being
      // written without a `name:` key, and every assertion here would still
      // pass against the one step this test does look at.
      expect(countUploadSteps(workflow), file).toBe(1)
      expect(steps, file).toHaveLength(1)
      expect(steps[0], file).toContain(gate)
      expect(steps[0], file).toContain(artifact)
      // An exact list, not a containment check: a raw trace or database path
      // added beside the sanitized globs in this step's path block has to fail
      // here, and the count above is what keeps it from being added in a step
      // of its own instead.
      expect(uploadedPaths(steps[0]), file).toEqual(paths)
      expect(workflow, file).not.toMatch(/upload-artifact[\s\S]{0,500}(?:trace\.zip|playwright-artifacts|html-report|storage-state|\.db\b)/u)
    }
  })

  /*
   * The five configurations this named were the five that gated on the day it
   * was written. Two more gate now, and neither was added here, so the rule went
   * on passing while the only two suites that did retain a raw trace were
   * exactly the ones nothing was looking at. Reading the directory deletes the
   * step a person has to remember. Every configuration is in scope except the
   * capture harness, which never runs in a workflow and exists to produce
   * artifacts a person reads (tests/e2e/README.md): a suite does not have to be
   * wired up yet to be forbidden from writing a trace zip nothing can collect.
   *
   * Asserted against the evaluated configuration rather than its source: these
   * files build half of `use` from the environment at module scope, and a
   * `toContain('trace: "off"')` would be satisfied just as well by that literal
   * sitting in a comment above a key that says something else.
   */
  it("disables raw trace, video and automatic screenshot retention in every suite but the manual capture harness", async () => {
    const configFileNames = readdirSync(e2eDirectory)
      .filter((entry) => entry.startsWith("playwright.")
        && entry.endsWith(".config.ts")
        && entry !== "playwright.config.ts")
      .sort()
    expect(configFileNames.length).toBeGreaterThan(5)

    // Two configurations refuse to load without the environment their runner
    // supplies. These values only have to satisfy those guards; nothing here
    // starts a server, and the database only has to exist.
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "smba-diagnostics-"))
    const disposableDatabase = path.join(temporaryDirectory, "academy-stress.db")
    writeFileSync(disposableDatabase, "")
    vi.stubEnv("SMBA_PHASE8_DISPOSABLE_DB", disposableDatabase)
    vi.stubEnv("SMBA_REGISTRATION_RESILIENCE_BASE_URL", "http://127.0.0.1:3101")

    try {
      for (const fileName of configFileNames) {
        const specifier = pathToFileURL(path.join(e2eDirectory, fileName)).href
        const loaded = await import(/* @vite-ignore */ specifier) as {
          default: { use?: { screenshot?: unknown; trace?: unknown; video?: unknown } }
        }

        expect(loaded.default.use?.screenshot, fileName).toBe("off")
        expect(loaded.default.use?.trace, fileName).toBe("off")
        expect(loaded.default.use?.video, fileName).toBe("off")
      }
    } finally {
      vi.unstubAllEnvs()
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })

  it("keeps production-included log sanitization independent from ignored test files", () => {
    const sanitizer = readRepositoryFile("scripts/regression/sanitize-server-log.ts")

    expect(sanitizer).toContain('from "./failure-evidence-sanitizer"')
    expect(sanitizer).not.toContain("tests/")
  })

  it("smokes only the canonical origin after a trusted deployment", () => {
    const alerts = readRepositoryFile(".github/workflows/production-alerts.yml")
    const health = readRepositoryFile(".github/workflows/production-health.yml")

    expect(alerts).toContain("github.event.deployment.environment == 'Production'")
    expect(alerts).toContain("github.event.deployment.creator.login == 'vercel[bot]'")
    expect(alerts).toContain("github.event.deployment.task == 'deploy'")
    expect(alerts).toContain("contains(fromJSON('[\"success\",\"failure\",\"error\"]'), github.event.deployment_status.state)")
    expect(alerts).toContain('ref: ${{ github.event.repository.default_branch }}')
    expect(alerts).toContain("classify-production-deployment.js")
    expect(alerts).toContain("https://smbaacademy.in --attempts 12 --delay-ms 10000")
    expect(health).toContain("https://smbaacademy.in --attempts 3 --delay-ms 5000")
    expect(health).not.toContain("runs-on: ubuntu-latest")
  })
})
