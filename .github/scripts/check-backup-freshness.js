"use strict"

const MAX_BACKUP_AGE_MS = 30 * 60 * 60 * 1000
const MAX_RESTORE_AGE_MS = 35 * 24 * 60 * 60 * 1000

/*
 * This gate asks whether a backup ran last night. That is the wrong question
 * while the nightly schedule is deliberately off -- it was disabled on
 * 2026-09-03 because the snapshots went to actions/upload-artifact on a public
 * repository, and the reason is written at the top of that workflow. Asking it
 * anyway failed the monitor every half hour and held a production alert open
 * against a state somebody chose, which is how a monitor stops being read.
 *
 * So the answer comes from the workflow itself rather than from a flag of our
 * own, and the mute lifts itself: restoring the `schedule:` trigger restores
 * the 30-hour gate in the same commit, with nothing separate to remember. The
 * age is still reported while muted, because "no backup since 3 September" is
 * the fact worth keeping in front of whoever reads the run.
 *
 * The caller passes the workflow text in, like every other input here, so this
 * module stays a pure function of its arguments and touches no filesystem.
 *
 * Comment stripping is deliberately naive -- a `#` inside a quoted value would
 * confuse it. No cron expression or trigger name contains one.
 */
function backupScheduleIsEnabled(source) {
  const lines = source.split("\n").map((line) => line.replace(/#.*$/u, ""))
  const start = lines.findIndex((line) => /^["']?on["']?\s*:/u.test(line))
  if (start === -1) return false

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue
    // A key back at column zero ends the `on:` block.
    if (/^\S/u.test(line)) return false
    if (/^\s+["']?schedule["']?\s*:/u.test(line)) return true
  }
  return false
}

function latestSuccessfulMain(runs, { defaultBranch, repository }) {
  return runs.find((run) => run.conclusion === "success"
    && run.head_branch === defaultBranch
    && run.head_repository?.full_name === repository)
}

function ageMilliseconds(timestamp, now) {
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) throw new Error("A workflow run has an invalid timestamp.")
  return now.getTime() - time
}

async function listRuns(github, { branch, owner, repo, workflowId }) {
  const response = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: workflowId,
    branch,
    status: "completed",
    per_page: 100,
  })
  return response.data.workflow_runs
}

async function listArtifacts(github, { owner, repo, runId }) {
  if (typeof github.paginate === "function") {
    return github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
      owner,
      repo,
      run_id: runId,
      per_page: 100,
    })
  }
  const response = await github.rest.actions.listWorkflowRunArtifacts({
    owner,
    repo,
    run_id: runId,
    per_page: 100,
  })
  return response.data.artifacts
}

module.exports = async function checkBackupFreshness({
  backupWorkflowSource,
  defaultBranch,
  github,
  now = new Date(),
  owner,
  repo,
}) {
  if (typeof backupWorkflowSource !== "string") {
    throw new Error("The encrypted-production-backup workflow source was not supplied.")
  }
  const scheduled = backupScheduleIsEnabled(backupWorkflowSource)
  const repository = `${owner}/${repo}`
  const [backupRuns, restoreRuns] = await Promise.all([
    listRuns(github, {
      branch: defaultBranch,
      owner,
      repo,
      workflowId: "encrypted-production-backup.yml",
    }),
    listRuns(github, {
      branch: defaultBranch,
      owner,
      repo,
      workflowId: "encrypted-backup-restore.yml",
    }),
  ])
  const backup = latestSuccessfulMain(backupRuns, { defaultBranch, repository })
  const restore = latestSuccessfulMain(restoreRuns, { defaultBranch, repository })

  if (!scheduled) {
    return {
      backupAgeHours: backup
        ? Math.floor(ageMilliseconds(backup.updated_at || backup.created_at, now) / 3_600_000)
        : null,
      backupRunId: backup ? backup.id : null,
      muted: true,
    }
  }

  if (!backup) throw new Error("No successful main-branch encrypted backup is available.")
  if (!restore) throw new Error("No successful main-branch stored-backup restore verification is available.")
  if (ageMilliseconds(backup.updated_at || backup.created_at, now) > MAX_BACKUP_AGE_MS) {
    throw new Error("The latest successful encrypted backup is older than 30 hours.")
  }
  if (ageMilliseconds(restore.updated_at || restore.created_at, now) > MAX_RESTORE_AGE_MS) {
    throw new Error("The latest successful stored-backup restore verification is older than 35 days.")
  }
  const expectedName = `smba-production-backup-${backup.id}-${backup.run_attempt}`
  const artifacts = await listArtifacts(github, { owner, repo, runId: backup.id })
  const artifact = artifacts.find((candidate) => candidate.name === expectedName && !candidate.expired)
  if (!artifact) throw new Error("The latest encrypted backup artifact is missing or expired.")
  return {
    artifactId: artifact.id,
    backupRunId: backup.id,
    muted: false,
    restoreRunId: restore.id,
  }
}

module.exports.ageMilliseconds = ageMilliseconds
module.exports.backupScheduleIsEnabled = backupScheduleIsEnabled
module.exports.latestSuccessfulMain = latestSuccessfulMain
