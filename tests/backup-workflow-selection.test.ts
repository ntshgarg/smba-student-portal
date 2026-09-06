import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

import { describe, expect, it, vi } from "vitest"

const SCHEDULED_WORKFLOW = `name: Encrypted production backup

on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:
`

const UNSCHEDULED_WORKFLOW = `name: Encrypted production backup

on:
  # The nightly schedule is off; see the workflow for why.
  #   - cron: "0 3 * * *"
  workflow_dispatch:
`

const require = createRequire(import.meta.url)
const selectBackupArtifact = require("../.github/scripts/select-backup-artifact.js") as (
  input: Record<string, unknown>
) => Promise<Record<string, unknown>>
const checkBackupFreshness = require("../.github/scripts/check-backup-freshness.js") as ((
  input: Record<string, unknown>
) => Promise<Record<string, unknown>>) & {
  backupScheduleIsEnabled: (source: string) => boolean
}
const { backupScheduleIsEnabled } = checkBackupFreshness

function trustedRun(overrides: Record<string, unknown> = {}) {
  return {
    conclusion: "success",
    created_at: "2026-08-22T01:00:00Z",
    head_branch: "main",
    head_repository: { full_name: "owner/repo" },
    id: 101,
    name: "Encrypted production backup",
    run_attempt: 2,
    updated_at: "2026-08-22T01:05:00Z",
    ...overrides,
  }
}

function githubMock({ backupRuns = [trustedRun()], restoreRuns = [trustedRun({
  id: 202,
  name: "Encrypted backup restore verification",
})], artifacts = [{
  created_at: "2026-08-22T01:06:00Z",
  digest: `sha256:${"a".repeat(64)}`,
  expired: false,
  id: 303,
  name: "smba-production-backup-101-2",
}] } = {}) {
  return {
    paginate: vi.fn(async () => artifacts),
    rest: {
      actions: {
        getWorkflowRun: vi.fn(async () => ({ data: backupRuns[0] })),
        listWorkflowRunArtifacts: vi.fn(),
        listWorkflowRuns: vi.fn(async ({ workflow_id }: { workflow_id: string }) => ({
          data: { workflow_runs: workflow_id.includes("restore") ? restoreRuns : backupRuns },
        })),
      },
    },
  }
}

describe("stored backup workflow selection", () => {
  it("selects exactly one successful unexpired main artifact", async () => {
    const selected = await selectBackupArtifact({
      defaultBranch: "main",
      github: githubMock(),
      owner: "owner",
      repo: "repo",
      requestedRunId: "101",
    })
    expect(selected).toMatchObject({ artifactId: 303, runId: 101 })
  })

  it("rejects untrusted, invalid and expired requested runs", async () => {
    await expect(selectBackupArtifact({
      defaultBranch: "main",
      github: githubMock(),
      owner: "owner",
      repo: "repo",
      requestedRunId: "not-a-number",
    })).rejects.toThrow("invalid")
    await expect(selectBackupArtifact({
      defaultBranch: "main",
      github: githubMock({ backupRuns: [trustedRun({ head_branch: "feature" })] }),
      owner: "owner",
      repo: "repo",
      requestedRunId: "101",
    })).rejects.toThrow("not a successful trusted")
    await expect(selectBackupArtifact({
      defaultBranch: "main",
      github: githubMock({ artifacts: [] }),
      owner: "owner",
      repo: "repo",
      requestedRunId: "101",
    })).rejects.toThrow("exactly one unexpired")
  })

  it("requires a backup within 30 hours, restore within 35 days and live artifact", async () => {
    const result = await checkBackupFreshness({
      backupWorkflowSource: SCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: githubMock(),
      now: new Date("2026-08-23T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })
    expect(result).toEqual({ artifactId: 303, backupRunId: 101, muted: false, restoreRunId: 202 })

    await expect(checkBackupFreshness({
      backupWorkflowSource: SCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: githubMock({ backupRuns: [trustedRun({ updated_at: "2026-08-20T00:00:00Z" })] }),
      now: new Date("2026-08-23T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })).rejects.toThrow("older than 30 hours")
  })
})

/*
 * The 30-hour gate is muted while the nightly backup schedule is deliberately
 * disabled, and it un-mutes itself when the schedule comes back. That coupling
 * is the whole design, so it is asserted against the real workflow file rather
 * than a fixture: if someone re-enables the schedule, the last case here starts
 * failing and says so.
 */
describe("backup freshness while the nightly schedule is disabled", () => {
  it("reads the schedule out of the workflow, comments and all", () => {
    expect(backupScheduleIsEnabled(SCHEDULED_WORKFLOW)).toBe(true)
    expect(backupScheduleIsEnabled(UNSCHEDULED_WORKFLOW)).toBe(false)
    // The live file disables it by commenting the trigger out, not deleting it.
    expect(backupScheduleIsEnabled('on:\n  # schedule:\n  #   - cron: "0 3 * * *"\n  workflow_dispatch:\n'))
      .toBe(false)
    // A `schedule:` key belonging to some later top-level block is not this one.
    expect(backupScheduleIsEnabled("on:\n  workflow_dispatch:\njobs:\n  schedule:\n")).toBe(false)
  })

  it("passes with the backup's age instead of failing, and names the run", async () => {
    await expect(checkBackupFreshness({
      backupWorkflowSource: UNSCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: githubMock({ backupRuns: [trustedRun({ updated_at: "2026-08-20T00:00:00Z" })] }),
      now: new Date("2026-08-23T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })).resolves.toEqual({ backupAgeHours: 72, backupRunId: 101, muted: true })
  })

  it("still passes when no backup has ever run", async () => {
    await expect(checkBackupFreshness({
      backupWorkflowSource: UNSCHEDULED_WORKFLOW,
      defaultBranch: "main",
      github: githubMock({ backupRuns: [] }),
      now: new Date("2026-08-23T00:00:00Z"),
      owner: "owner",
      repo: "repo",
    })).resolves.toEqual({ backupAgeHours: null, backupRunId: null, muted: true })
  })

  it("is muted for the workflow as it stands on disk today", () => {
    const live = readFileSync(
      new URL("../.github/workflows/encrypted-production-backup.yml", import.meta.url),
      "utf8",
    )
    expect(backupScheduleIsEnabled(live)).toBe(false)
  })
})
