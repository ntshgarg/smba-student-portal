"use strict"

const MAX_BACKUP_AGE_MS = 30 * 60 * 60 * 1000
const MAX_RESTORE_AGE_MS = 35 * 24 * 60 * 60 * 1000

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
  defaultBranch,
  github,
  now = new Date(),
  owner,
  repo,
}) {
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
    restoreRunId: restore.id,
  }
}

module.exports.ageMilliseconds = ageMilliseconds
module.exports.latestSuccessfulMain = latestSuccessfulMain
