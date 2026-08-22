import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const repositoryRoot = path.resolve(import.meta.dirname, "..")

function readRepositoryFile(file: string) {
  return readFileSync(path.join(repositoryRoot, file), "utf8")
}

describe("CI failure diagnostics and deployment verification", () => {
  it("uploads only allowlisted sanitized browser evidence on failure", () => {
    const quality = readRepositoryFile(".github/workflows/quality.yml")
    const accessibility = readRepositoryFile(".github/workflows/ui-accessibility.yml")
    const workflows = `${quality}\n${accessibility}`

    expect(workflows).toContain("if: failure()")
    expect(workflows).toContain("${{ github.run_id }}-${{ github.run_attempt }}")
    expect(workflows).toContain("**/*.masked.png")
    expect(workflows).toContain("**/*.sanitized.json")
    expect(workflows).toContain("**/*.sanitized.txt")
    expect(workflows).not.toMatch(/upload-artifact[\s\S]{0,500}(?:trace\.zip|playwright-artifacts|html-report|storage-state|\.db\b)/u)
  })

  it("disables raw trace, video and automatic screenshot retention in required suites", () => {
    for (const file of [
      "tests/e2e/playwright.registration-resilience.config.ts",
      "tests/e2e/playwright.authentication.config.ts",
      "tests/e2e/playwright.onboarding.config.ts",
      "tests/e2e/playwright.attendance-workspaces.config.ts",
      "tests/e2e/playwright.accessibility.config.ts",
    ]) {
      const config = readRepositoryFile(file)
      expect(config, file).toContain('trace: "off"')
      expect(config, file).toContain('video: "off"')
      expect(config, file).toContain('screenshot: "off"')
    }
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
