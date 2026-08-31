import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const repositoryRoot = path.resolve(import.meta.dirname, "..")
const workflowDirectory = ".github/workflows"

function readRepositoryFile(file: string) {
  return readFileSync(path.join(repositoryRoot, file), "utf8")
}

// Events that run in the *base* repository, with full access to repository
// secrets, while being reachable by someone who has no write access to it. What
// a job triggered by one of these checks out has to be trusted code, because it
// will be executed next to a secret.
//
// `pull_request` is deliberately absent: a fork's pull_request run gets a
// read-only token and no secrets, which is exactly why quality.yml and
// ui-accessibility.yml check out the contributor's own commit there.
const untrustedEvents = ["deployment_status", "issue_comment", "pull_request_target", "workflow_run"]

// Of those four, deployment_status is the one where omitting `ref:` is already
// wrong: GitHub resolves GITHUB_SHA for it to the commit being deployed, which
// for a fork pull request is the fork's commit. workflow_run, issue_comment and
// pull_request_target all resolve it to the default or base branch, so there an
// absent `ref:` is trusted by default.
const implicitlyUntrustedCheckoutEvents = ["deployment_status"]

const trustedCheckoutRef = "${{ github.event.repository.default_branch }}"

function workflowFileNames() {
  return readdirSync(path.join(repositoryRoot, workflowDirectory))
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .sort()
}

// The `on:` block runs until the next top-level key; its two-space children are
// the event names. Blank lines inside it are not top-level keys.
function workflowTriggers(workflow: string) {
  const lines = workflow.split("\n")
  const triggers: string[] = []

  for (const line of lines.slice(lines.indexOf("on:") + 1)) {
    if (/^\S/u.test(line)) break
    const event = /^ {2}([a-z_]+):/u.exec(line)
    if (event) triggers.push(event[1])
  }

  return triggers
}

// Job names sit at two spaces and every key inside a job at four or more, so a
// bare two-space key line is unambiguously the start of the next job.
function workflowJobs(workflow: string) {
  const lines = workflow.split("\n")
  const jobs: { body: string; name: string }[] = []
  let current: { lines: string[]; name: string } | undefined

  for (const line of lines.slice(lines.indexOf("jobs:") + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):$/u.exec(line)
    if (header) {
      if (current) jobs.push({ body: current.lines.join("\n"), name: current.name })
      current = { lines: [], name: header[1] }
      continue
    }
    current?.lines.push(line)
  }
  if (current) jobs.push({ body: current.lines.join("\n"), name: current.name })

  return jobs
}

// Only the job-level `if:` (four spaces) narrows which events can reach a job.
// A step-level one does not: the job, and its checkout, has already run.
function jobCondition(job: string) {
  const lines = job.split("\n")
  const start = lines.findIndex((line) => /^ {4}if:/u.test(line))
  if (start === -1) return ""

  const condition = [lines[start].replace(/^ {4}if:\s*/u, "")]
  for (const line of lines.slice(start + 1)) {
    if (!/^ {6}/u.test(line)) break
    condition.push(line.trim())
  }

  return condition.join(" ")
}

// A job that pins github.event_name can only run for the events it names.
// Anything else -- including a `!=` form -- counts as reachable from every
// trigger, so an unrecognised guard errs towards flagging rather than passing.
function jobEvents(job: string, triggers: string[]) {
  const pinned = [...jobCondition(job).matchAll(/github\.event_name == '([a-z_]+)'/gu)]
    .map((match) => match[1])

  return pinned.length > 0 ? triggers.filter((trigger) => pinned.includes(trigger)) : triggers
}

function workflowSteps(body: string) {
  return body.split(/\n(?=      - )/u)
}

function checkoutRef(step: string) {
  return /^ {10}ref: (.+)$/mu.exec(step)?.[1]
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
    expect(workflow).toContain("run-id: ${{ steps.backup.outputs.run-id }}")
    expect(workflow).toContain("repository: ${{ github.repository }}")
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

  // The class-level form of the preview-smoke hole: deployment_status runs in
  // the base repository with every secret available, so checking out the SHA it
  // carries executes a fork contributor's code beside those secrets. Asserted
  // over every workflow rather than over that one file, so the next workflow to
  // take an untrusted trigger cannot reintroduce it quietly.
  it("checks out only the default branch in jobs an untrusted event can reach", () => {
    const inspected: string[] = []
    const checkedOutAnUntrustedRef: string[] = []
    const leftTheCheckoutRefImplicit: string[] = []

    for (const file of workflowFileNames()) {
      const workflow = readRepositoryFile(`${workflowDirectory}/${file}`)
      const triggers = workflowTriggers(workflow)
      if (!triggers.some((trigger) => untrustedEvents.includes(trigger))) continue

      for (const job of workflowJobs(workflow)) {
        const events = jobEvents(job.body, triggers)
        if (!events.some((event) => untrustedEvents.includes(event))) continue
        inspected.push(`${file} ${job.name}`)

        const implicitRefIsUntrusted = events
          .some((event) => implicitlyUntrustedCheckoutEvents.includes(event))

        for (const step of workflowSteps(job.body)) {
          if (!step.includes("uses: actions/checkout")) continue
          const ref = checkoutRef(step)

          if (ref === undefined) {
            if (implicitRefIsUntrusted) leftTheCheckoutRefImplicit.push(`${file} ${job.name}`)
          } else if (ref !== trustedCheckoutRef) {
            checkedOutAnUntrustedRef.push(`${file} ${job.name}: ${ref}`)
          }
        }
      }
    }

    expect(checkedOutAnUntrustedRef).toEqual([])
    expect(leftTheCheckoutRefImplicit).toEqual([])

    // Without this the whole assertion above passes vacuously the moment the
    // trigger or job parsing stops matching the files it is reading.
    expect(inspected).toContain("preview-smoke.yml smoke")
    expect(inspected).toContain("production-alerts.yml deployment-result")
    expect(inspected).toContain("production-alerts.yml workflow-result")
    expect(inspected).not.toContain("production-alerts.yml manual-delivery-test")
  })

  it("smokes the preview with trusted code and passes the origin as data", () => {
    const workflow = readRepositoryFile(`${workflowDirectory}/preview-smoke.yml`)

    // Matched on the `ref:` key rather than on the file text, so the comment
    // that explains why github.event.deployment.sha is forbidden can go on
    // naming it.
    const checkouts = workflowSteps(workflow).filter((step) => step.includes("uses: actions/checkout"))
    expect(checkouts).toHaveLength(1)
    expect(checkouts.map((step) => checkoutRef(step))).toEqual([trustedCheckoutRef])

    const verify = workflowSteps(workflow)
      .find((step) => step.includes("- name: Verify the preview answers\n"))
    expect(verify).toBeTypeOf("string")
    // This is the one step that holds the secret; the assertions below are only
    // worth anything while that stays true.
    expect(verify).toContain("VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.")
    expect(verify).toContain("PREVIEW_ORIGIN: ${{ steps.target.outputs.origin }}")
    expect(verify).toContain(
      'node scripts/operations/check-production.mjs "$PREVIEW_ORIGIN"',
    )

    // Nothing payload-derived may be pasted into that step's shell: an
    // expression is substituted before bash parses the script, so it arrives as
    // source rather than as an argument.
    const step = verify ?? ""
    const runStart = step.indexOf("\n        run:")
    expect(runStart).toBeGreaterThan(-1)
    expect(step.slice(runStart)).not.toContain("${{")
  })
})
