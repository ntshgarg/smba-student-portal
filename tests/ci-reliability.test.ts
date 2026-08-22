import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const repositoryRoot = path.resolve(import.meta.dirname, "..")

function readRepositoryFile(file: string) {
  return readFileSync(path.join(repositoryRoot, file), "utf8")
}

describe("CI reliability controls", () => {
  it("bounds ordinary Vitest work and isolates the fixture lifecycle suite", () => {
    const packageJson = JSON.parse(readRepositoryFile("package.json")) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts["test:ci"]).toBe(
      "vitest run --exclude tests/regression-fixture.test.ts --maxWorkers=2 --minWorkers=1",
    )
    expect(packageJson.scripts["regression:test"]).toBe(
      "vitest run tests/regression-fixture.test.ts --maxWorkers=1 --minWorkers=1",
    )
  })

  it("keeps static, unit, and browser work isolated behind the stable required check", () => {
    const workflow = readRepositoryFile(".github/workflows/quality.yml")

    expect(workflow).toMatch(/^  static:\n    name: Static validation$/mu)
    expect(workflow).toMatch(/^  unit:\n    name: Unit and operational tests$/mu)
    expect(workflow).toMatch(/^  browser:\n    name: Build and browser regression$/mu)
    expect(workflow).toMatch(/^  verify:\n    name: Application regression$/mu)
    expect(workflow).toContain("needs: [static, unit, browser]")
    expect(workflow).toContain("npm run test:ci")
    expect(workflow).toContain("npm run regression:test")
    expect(workflow).toContain("npm run regression:finance:prepare")
    expect(workflow).toContain("npm run regression:finance")
    expect(workflow).toContain("/tmp/smba-ci-finance-${{ github.run_id }}-${{ github.run_attempt }}.db")
    expect(workflow).not.toContain("runs-on: ubuntu-latest")
  })

  it("polls the attendance URL state after opening a collapsed session", () => {
    const interactions = readRepositoryFile(
      "tests/e2e/support/accessibility-interactions.ts",
    )
    const regression = readRepositoryFile("tests/e2e/accessibility-regression.spec.ts")

    expect(interactions).toContain('url.searchParams.get("occurrence")')
    expect(interactions).toContain("url.href !== initialUrl")
    expect(interactions).toContain('candidate.getAttribute("aria-expanded")')
    expect(interactions).toContain('=== "false"')
    expect(interactions).toContain("await expect.poll(() => {")
    expect(interactions).not.toContain("await page.waitForURL((url) => url.href !== initialUrl")
    expect(interactions).toContain('toHaveAttribute("aria-expanded", "true")')
    expect(interactions).toContain('toHaveClass(/has-selection/u)')
    expect(regression).toContain([
      "await page.waitForFunction(() => document.title.trim().length > 0, undefined, {",
      "    timeout: 5_000,",
      "  }).catch(() => undefined)",
    ].join("\n"))
  })
})
