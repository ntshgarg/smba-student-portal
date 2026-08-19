import { createRequire } from "node:module"

import { describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
const syncProductionAlert = require("../.github/scripts/sync-production-alert.js") as (input: {
  core: { notice: (message: string) => void; setFailed: (message: string) => void }
  detailsUrl: string
  github: ReturnType<typeof githubClient>
  key: string
  owner: string
  repo: string
  status: "open" | "resolved"
  summary: string
}) => Promise<void>

function githubClient(openIssues: Array<Record<string, unknown>> = []) {
  return {
    rest: {
      issues: {
        create: vi.fn().mockResolvedValue({ data: { number: 42 } }),
        createComment: vi.fn().mockResolvedValue({}),
        createLabel: vi.fn().mockResolvedValue({}),
        getLabel: vi.fn().mockResolvedValue({}),
        listForRepo: vi.fn().mockResolvedValue({ data: openIssues }),
        update: vi.fn().mockResolvedValue({}),
      },
    },
  }
}

function input(github: ReturnType<typeof githubClient>, status: "open" | "resolved") {
  return {
    core: { notice: vi.fn(), setFailed: vi.fn() },
    detailsUrl: "https://example.test/run/1",
    github,
    key: "Production health",
    owner: "academy-owner",
    repo: "portal",
    status,
    summary: "Production health failed.",
  }
}

describe("production alert synchronization", () => {
  it("opens one assigned issue for a new failure", async () => {
    const github = githubClient()
    const alert = input(github, "open")

    await syncProductionAlert(alert)

    expect(github.rest.issues.create).toHaveBeenCalledWith(expect.objectContaining({
      assignees: ["academy-owner"],
      labels: ["production-alert"],
      title: "[Production alert] Production health",
    }))
    expect(alert.core.setFailed).toHaveBeenCalledWith("Opened production alert #42.")
  })

  it("updates an existing alert instead of opening duplicates", async () => {
    const github = githubClient([{
      number: 8,
      title: "[Production alert] Production health",
    }])
    const alert = input(github, "open")

    await syncProductionAlert(alert)

    expect(github.rest.issues.create).not.toHaveBeenCalled()
    expect(github.rest.issues.createComment).toHaveBeenCalledWith(expect.objectContaining({
      issue_number: 8,
    }))
    expect(alert.core.setFailed).toHaveBeenCalledWith("Production alert #8 remains open.")
  })

  it("closes the matching alert only after recovery", async () => {
    const github = githubClient([{
      number: 11,
      title: "[Production alert] Production health",
    }])
    const alert = input(github, "resolved")

    await syncProductionAlert(alert)

    expect(github.rest.issues.update).toHaveBeenCalledWith(expect.objectContaining({
      issue_number: 11,
      state: "closed",
      state_reason: "completed",
    }))
    expect(alert.core.notice).toHaveBeenCalledWith("Closed recovered production alert #11.")
    expect(alert.core.setFailed).not.toHaveBeenCalled()
  })
})
