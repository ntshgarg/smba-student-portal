import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const repositoryRoot = path.resolve(import.meta.dirname, "..")

function readRepositoryFile(file: string) {
  return readFileSync(path.join(repositoryRoot, file), "utf8")
}

describe("CI security controls", () => {
  it("limits backup credentials to the snapshot and encryption steps", () => {
    const workflow = readRepositoryFile(".github/workflows/encrypted-production-backup.yml")

    expect(workflow).not.toMatch(/^    env:\n(?:      .*\n)*      SMBA_/mu)
    expect(workflow).toContain("- name: Create logical snapshot\n        env:\n          SMBA_DATABASE_SNAPSHOT_SOURCE:")
    expect(workflow).toContain("- name: Encrypt snapshot and manifest\n        env:\n          SMBA_BACKUP_PASSPHRASE:")
    expect(workflow).toContain("--passphrase-fd 0")
    expect(workflow).not.toContain('--passphrase "$SMBA_BACKUP_PASSPHRASE"')
    expect(workflow.indexOf("Install dependencies")).toBeLessThan(
      workflow.indexOf("SMBA_DATABASE_SNAPSHOT_SOURCE"),
    )
    expect(workflow).toContain("ref: ${{ github.event.repository.default_branch }}")
    expect(workflow).toContain('- cron: "47 2 * * *"')
    expect(workflow).toContain("smba-production-backup-${{ github.run_id }}-${{ github.run_attempt }}")
    expect(workflow).toContain("retention-days: 35")
  })

  it("gives the stored restore only Actions read access and step-scoped passphrase", () => {
    const workflow = readRepositoryFile(".github/workflows/encrypted-backup-restore.yml")

    expect(workflow).toContain("permissions:\n  actions: read\n  contents: read")
    expect(workflow).not.toContain("SMBA_BACKUP_DATABASE_URL")
    expect(workflow).not.toContain("SMBA_BACKUP_DATABASE_TOKEN")
    expect(workflow.match(/SMBA_BACKUP_PASSPHRASE: \$\{\{ secrets\.SMBA_BACKUP_PASSPHRASE \}\}/gu))
      .toHaveLength(1)
    expect(workflow).toContain('- cron: "47 4 1 * *"')
    expect(workflow).toContain("cleanup-restore-workspace.mjs")
    expect(workflow).not.toContain("upload-artifact")
  })

  it("exposes monitor credentials only to the read-only monitoring step", () => {
    const workflow = readRepositoryFile(".github/workflows/operations-monitor.yml")

    expect(workflow).not.toMatch(/^    env:\n(?:      .*\n)*      SMBA_/mu)
    expect(workflow).toMatch(
      /      - name: Check production security signals without exposing accounts\n        env:\n          SMBA_MONITOR_DATABASE_URL: \$\{\{ secrets\.SMBA_BACKUP_DATABASE_URL \}\}\n          SMBA_MONITOR_DATABASE_TOKEN: \$\{\{ secrets\.SMBA_BACKUP_DATABASE_TOKEN \}\}/u,
    )
    expect(workflow.indexOf("Install dependencies")).toBeLessThan(
      workflow.indexOf("SMBA_MONITOR_DATABASE_URL"),
    )
    expect(workflow).toContain("actions: read")
    expect(workflow).toContain("check-backup-freshness.js")
  })

  it("allows only default-branch workflow runs to synchronize production alerts", () => {
    const workflow = readRepositoryFile(".github/workflows/production-alerts.yml")

    expect(workflow).toContain("- UI accessibility")
    expect(workflow).toContain("- Encrypted backup restore verification")
    expect(workflow).toContain(
      "github.event.workflow_run.head_branch == github.event.repository.default_branch",
    )
    expect(workflow).toContain(
      "github.event.workflow_run.head_repository.full_name == github.repository",
    )
    expect(workflow).not.toContain("runs-on: ubuntu-latest")
  })

  it("schedules bounded npm and GitHub Actions dependency updates", () => {
    const dependabot = readRepositoryFile(".github/dependabot.yml")

    expect(dependabot.match(/package-ecosystem:/gu)).toHaveLength(2)
    expect(dependabot).toContain("package-ecosystem: npm")
    expect(dependabot).toContain("package-ecosystem: github-actions")
    expect(dependabot).toContain("production-minor-and-patch")
    expect(dependabot).toContain("development-minor-and-patch")
    expect(dependabot.match(/open-pull-requests-limit: 5/gu)).toHaveLength(2)
  })
})
