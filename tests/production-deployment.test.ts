import { createRequire } from "node:module"

import { describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
const classify = require("../.github/scripts/classify-production-deployment.js") as (
  input: ReturnType<typeof deploymentInput>,
) => Promise<{ reason: string; shouldSmoke?: boolean; state?: string; trusted: boolean }>

const DEPLOYED_SHA = "a".repeat(40)
const MAIN_SHA = "b".repeat(40)

function deploymentInput(overrides: Record<string, unknown> = {}) {
  const github = {
    rest: {
      repos: {
        compareCommitsWithBasehead: vi.fn().mockResolvedValue({ data: { status: "ahead" } }),
        getBranch: vi.fn().mockResolvedValue({ data: { commit: { sha: MAIN_SHA } } }),
      },
    },
  }
  return {
    deployment: {
      creator: { login: "vercel[bot]" },
      environment: "Production",
      sha: DEPLOYED_SHA,
      task: "deploy",
      ...overrides,
    },
    deploymentStatus: { state: "success" },
    github,
    owner: "academy-owner",
    repo: "portal",
  }
}

describe("production deployment trust classification", () => {
  it("accepts the current main deployment and requests a smoke test", async () => {
    const input = deploymentInput({ sha: MAIN_SHA })
    await expect(classify(input)).resolves.toMatchObject({ shouldSmoke: true, trusted: true })
    expect(input.github.rest.repos.compareCommitsWithBasehead).not.toHaveBeenCalled()
  })

  it.each([
    ["Preview", { environment: "Preview" }, { state: "success" }],
    ["transitional", {}, { state: "pending" }],
    ["forged actor", { creator: { login: "attacker" } }, { state: "success" }],
    ["untrusted task", { task: "deploy:preview" }, { state: "success" }],
  ])("ignores %s deployment events", async (_label, overrides, status) => {
    const input = deploymentInput(overrides)
    input.deploymentStatus = status
    await expect(classify(input)).resolves.toMatchObject({ trusted: false })
    expect(input.github.rest.repos.getBranch).not.toHaveBeenCalled()
  })

  it("accepts a deployed commit that is an ancestor of main", async () => {
    const input = deploymentInput()
    await expect(classify(input)).resolves.toMatchObject({ shouldSmoke: true, trusted: true })
    expect(input.github.rest.repos.compareCommitsWithBasehead).toHaveBeenCalledWith(expect.objectContaining({
      basehead: `${DEPLOYED_SHA}...${MAIN_SHA}`,
    }))
  })

  it("trusts a failed main deployment without requesting a smoke", async () => {
    const input = deploymentInput({ sha: MAIN_SHA })
    input.deploymentStatus = { state: "failure" }
    await expect(classify(input)).resolves.toMatchObject({
      shouldSmoke: false,
      state: "failure",
      trusted: true,
    })
  })

  it("rejects an unrelated deployment SHA", async () => {
    const input = deploymentInput()
    input.github.rest.repos.compareCommitsWithBasehead.mockResolvedValue({ data: { status: "diverged" } })
    await expect(classify(input)).resolves.toMatchObject({ trusted: false })
  })
})
