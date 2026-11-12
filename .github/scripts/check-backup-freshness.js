"use strict"

const MAX_BACKUP_AGE_MS = 30 * 60 * 60 * 1000
const MAX_RESTORE_AGE_MS = 35 * 24 * 60 * 60 * 1000
const SETUP_GUIDE = 'docs/PRODUCTION-OPERATIONS.md, "Scheduled encrypted backups"'

/*
 * This gate asks whether a backup was stored last night. It is muted only if
 * the nightly schedule in encrypted-production-backup.yml is switched off on
 * purpose -- it was, from 2026-09-03 until the head coach decided on 13 Nov
 * 2026 that the academy keeps nightly backups in a private store for 30 days.
 * Asking it while the schedule is off would fail the monitor every half hour
 * and hold a production alert open against a state somebody chose, which is how
 * a monitor stops being read.
 *
 * So the answer comes from the workflow itself rather than from a flag of our
 * own, and the mute lifts itself: restoring the `schedule:` trigger restores
 * the 30-hour gate in the same commit, with nothing separate to remember. The
 * age is still reported while muted.
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

  // A successful run is a stored backup: putting the file in the private
  // backup store is that workflow's last step, and the run fails if it fails.
  //
  // Nothing stored yet means the store has not been set up, or every night so
  // far has failed. Each of those nights already fails "Encrypted production
  // backup" itself, which Production alerts reports once a night with the
  // reason. Failing here too would comment on an alert every half hour and
  // bury this workflow's other job, the sign-in security signals -- so this
  // says the same thing as a warning instead.
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
    // The first restore check runs on the 1st of the month after backups
    // begin, so it is only overdue once backups are older than the 35 days
    // allowed between checks.
    const firstBackup = backupRuns.filter((run) => latestSuccessfulMain([run], { defaultBranch, repository })).at(-1)
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
module.exports.latestSuccessfulMain = latestSuccessfulMain
