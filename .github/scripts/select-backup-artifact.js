"use strict"

const BACKUP_WORKFLOW_NAME = "Encrypted production backup"

function isTrustedBackupRun(run, { defaultBranch, repository }) {
  return run?.name === BACKUP_WORKFLOW_NAME
    && run?.head_branch === defaultBranch
    && run?.head_repository?.full_name === repository
    && run?.conclusion === "success"
}

async function artifactsForRun({ github, owner, repo, runId }) {
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

module.exports = async function selectBackupArtifact({
  defaultBranch,
  github,
  owner,
  repo,
  requestedRunId,
}) {
  const repository = `${owner}/${repo}`
  let run
  if (requestedRunId) {
    if (!/^\d+$/u.test(String(requestedRunId))) {
      throw new Error("The supplied backup run ID is invalid.")
    }
    const response = await github.rest.actions.getWorkflowRun({
      owner,
      repo,
      run_id: Number(requestedRunId),
    })
    run = response.data
    if (!isTrustedBackupRun(run, { defaultBranch, repository })) {
      throw new Error("The supplied run is not a successful trusted main-branch backup.")
    }
  } else {
    const response = await github.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: "encrypted-production-backup.yml",
      branch: defaultBranch,
      status: "completed",
      per_page: 100,
    })
    run = response.data.workflow_runs.find((candidate) => (
      isTrustedBackupRun(candidate, { defaultBranch, repository })
    ))
    if (!run) throw new Error("No successful trusted main-branch backup run is available.")
  }

  const expectedName = `smba-production-backup-${run.id}-${run.run_attempt}`
  const artifacts = await artifactsForRun({ github, owner, repo, runId: run.id })
  const matches = artifacts.filter((artifact) => artifact.name === expectedName && !artifact.expired)
  if (matches.length !== 1) {
    throw new Error("The backup run does not contain exactly one unexpired encrypted artifact.")
  }
  const artifact = matches[0]
  if (!/^sha256:[a-f0-9]{64}$/u.test(artifact.digest || "")) {
    throw new Error("The encrypted artifact does not expose a valid immutable digest.")
  }
  return {
    artifactCreatedAt: artifact.created_at,
    artifactDigest: artifact.digest || "",
    artifactId: artifact.id,
    artifactName: artifact.name,
    runAttempt: run.run_attempt,
    runCreatedAt: run.created_at,
    runId: run.id,
  }
}

module.exports.isTrustedBackupRun = isTrustedBackupRun
