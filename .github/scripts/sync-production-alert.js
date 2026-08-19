const ALERT_LABEL = "production-alert"

async function ensureAlertLabel(github, owner, repo) {
  try {
    await github.rest.issues.getLabel({ owner, repo, name: ALERT_LABEL })
  } catch (error) {
    if (error.status !== 404) throw error
    await github.rest.issues.createLabel({
      owner,
      repo,
      name: ALERT_LABEL,
      color: "B60205",
      description: "Production operation requiring attention",
    })
  }
}

module.exports = async function syncProductionAlert({
  core,
  detailsUrl,
  github,
  key,
  owner,
  repo,
  status,
  summary,
}) {
  await ensureAlertLabel(github, owner, repo)

  const title = `[Production alert] ${key}`
  const { data: issues } = await github.rest.issues.listForRepo({
    owner,
    repo,
    labels: ALERT_LABEL,
    state: "open",
    per_page: 100,
  })
  const existing = issues.find((issue) => !issue.pull_request && issue.title === title)
  const timestamp = new Date().toISOString()

  if (status === "resolved") {
    if (!existing) return
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: existing.number,
      body: `Recovered at ${timestamp}.\n\n[Successful check](${detailsUrl})`,
    })
    await github.rest.issues.update({
      owner,
      repo,
      issue_number: existing.number,
      state: "closed",
      state_reason: "completed",
    })
    core.notice(`Closed recovered production alert #${existing.number}.`)
    return
  }

  const body = [
    summary,
    "",
    `Detected at ${timestamp}.`,
    "",
    `[Open the failing operation](${detailsUrl})`,
    "",
    "Follow `docs/PRODUCTION-OPERATIONS.md` before changing production data or credentials.",
  ].join("\n")

  if (existing) {
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: existing.number,
      body,
    })
    core.setFailed(`Production alert #${existing.number} remains open.`)
    return
  }

  const { data: issue } = await github.rest.issues.create({
    owner,
    repo,
    title,
    body,
    labels: [ALERT_LABEL],
    assignees: [owner],
  })
  core.setFailed(`Opened production alert #${issue.number}.`)
}
