"use strict"

const MAX_BACKUP_AGE_MS = 30 * 60 * 60 * 1000
const MAX_RESTORE_AGE_MS = 35 * 24 * 60 * 60 * 1000
const SETUP_GUIDE = 'docs/PRODUCTION-OPERATIONS.md, "Scheduled encrypted backups"'

// Runs before this date predate the private store; their backups were deleted.
const PRIVATE_STORE_SINCE = Date.parse("2026-11-13T00:00:00Z")

// The 30-hour gate is muted while encrypted-production-backup.yml has no
// `schedule:` trigger. Comment stripping is naive; no trigger contains a `#`.
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

function isSuccessfulMain(run, { defaultBranch, repository }) {
  return run.conclusion === "success"
    && run.head_branch === defaultBranch
    && run.head_repository?.full_name === repository
}

function startedAt(run) {
  const time = Date.parse(run.created_at)
  if (!Number.isFinite(time)) throw new Error("A workflow run has an invalid timestamp.")
  return time
}

/** Successful runs on main since the private store began, newest first. */
function storeEraRuns(runs, { defaultBranch, repository, since = PRIVATE_STORE_SINCE }) {
  return runs.filter((run) => isSuccessfulMain(run, { defaultBranch, repository }) && startedAt(run) >= since)
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
  const storedBackups = storeEraRuns(backupRuns, { defaultBranch, repository })
  const backup = storedBackups[0]
  const firstBackup = storedBackups.at(-1)
  // A restore check can only be of a stored backup once one exists.
  const restore = firstBackup
    ? storeEraRuns(restoreRuns, { defaultBranch, repository, since: startedAt(firstBackup) })[0]
    : undefined

  if (!scheduled) {
    return {
      backupAgeHours: backup
        ? Math.floor(ageMilliseconds(backup.updated_at || backup.created_at, now) / 3_600_000)
        : null,
      backupRunId: backup ? backup.id : null,
      muted: true,
    }
  }

  // No stored backup yet: the nightly run's own failure is the alert, so only warn.
  if (!backup) {
    return {
      backupAgeHours: null,
      backupRunId: null,
      message: "No backup has been stored yet. Beyond Turso's one-day rewind, the academy has no copy "
        + `of its records that could be restored. Finish setting up the private backup store (${SETUP_GUIDE}).`,
      muted: true,
    }
  }
  if (ageMilliseconds(backup.updated_at || backup.created_at, now) > MAX_BACKUP_AGE_MS) {
    throw new Error(
      "The newest stored backup is more than 30 hours old, so last night's backup did not finish. "
      + 'Open the latest "Encrypted production backup" run to see why.',
    )
  }
  if (!restore) {
    // No restore check is overdue until backups are older than 35 days.
    if (ageMilliseconds(firstBackup.updated_at || firstBackup.created_at, now) > MAX_RESTORE_AGE_MS) {
      throw new Error(
        "Backups have been stored for more than 35 days and none has been restored and checked. Open the "
        + 'latest "Encrypted backup restore verification" run to see why, or run it by hand.',
      )
    }
    return {
      backupRunId: backup.id,
      message: 'No stored backup has been restored and checked yet. "Encrypted backup restore '
        + 'verification" runs on the 1st of the month, or can be run by hand now.',
      muted: false,
      restoreRunId: null,
    }
  }
  if (ageMilliseconds(restore.updated_at || restore.created_at, now) > MAX_RESTORE_AGE_MS) {
    throw new Error(
      "The last successful restore check of a stored backup is more than 35 days old. "
      + 'Open the latest "Encrypted backup restore verification" run to see why.',
    )
  }
  return {
    backupRunId: backup.id,
    muted: false,
    restoreRunId: restore.id,
  }
}

module.exports.ageMilliseconds = ageMilliseconds
module.exports.backupScheduleIsEnabled = backupScheduleIsEnabled
module.exports.PRIVATE_STORE_SINCE = PRIVATE_STORE_SINCE
module.exports.storeEraRuns = storeEraRuns
