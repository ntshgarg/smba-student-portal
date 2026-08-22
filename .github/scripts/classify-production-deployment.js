async function classifyProductionDeployment({ deployment, deploymentStatus, github, owner, repo }) {
  if (deployment.environment !== "Production") {
    return { reason: `Ignored environment: ${deployment.environment}.`, trusted: false }
  }
  if (deployment.creator?.login !== "vercel[bot]") {
    return { reason: "Ignored deployment from an untrusted creator.", trusted: false }
  }
  if (deployment.task !== "deploy") {
    return { reason: `Ignored deployment task: ${deployment.task}.`, trusted: false }
  }
  if (!["success", "failure", "error"].includes(deploymentStatus.state)) {
    return { reason: `Ignored transitional deployment state: ${deploymentStatus.state}.`, trusted: false }
  }
  if (!/^[a-f0-9]{40}$/u.test(deployment.sha ?? "")) {
    return { reason: "Ignored deployment without a full commit SHA.", trusted: false }
  }

  const branch = await github.rest.repos.getBranch({ branch: "main", owner, repo })
  const mainSha = branch.data.commit.sha
  let shaRelationship = "identical"
  if (deployment.sha !== mainSha) {
    const comparison = await github.rest.repos.compareCommitsWithBasehead({
      basehead: `${deployment.sha}...${mainSha}`,
      owner,
      repo,
    })
    shaRelationship = comparison.data.status
  }
  if (!["ahead", "identical"].includes(shaRelationship)) {
    return { reason: "Ignored deployment whose commit is not on current main.", trusted: false }
  }

  return {
    reason: `Trusted ${deploymentStatus.state} production deployment.`,
    shouldSmoke: deploymentStatus.state === "success",
    state: deploymentStatus.state,
    trusted: true,
  }
}

module.exports = classifyProductionDeployment
