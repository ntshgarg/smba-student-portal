import { readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

/*
 * #131 stopped a fork pull request's commit being checked out and executed on
 * the runner beside every repository secret. It did not stop the other
 * direction: `scripts/operations/check-production.mjs` sends
 * x-vercel-protection-bypass *to* the preview, and for a fork pull request that
 * preview is running the fork author's own Next.js code, which can read the
 * header off the inbound request and log it.
 *
 * These pin the two locks that close it: the workflow will not run a
 * secret-bearing step unless the deployed commit classifies as trusted code,
 * and the smoke script will not put the secret on the wire unless the caller
 * passes that classification through.
 */

type Environment = Record<string, string | undefined>

interface SmokeScript {
  BYPASS_ENVIRONMENT_VARIABLE: string
  BYPASS_TRUST_ENVIRONMENT_VARIABLE: string
  bypassHeaders: (origin: URL, environment: Environment) => Record<string, string>
  checkProduction: (
    origin: string,
    options: { attempts?: number; environment?: Environment },
  ) => Promise<unknown>
}

// Every other .mjs a test imports is typed through a sidecar .d.mts beside it,
// and adding scripts/operations/check-production.d.mts is outside this lane's
// file set (docs/audit/fix-plan.md section 7.1). A computed specifier keeps the
// module out of the type checker's resolution, so the shape is declared above
// instead -- and it is still the real module that runs.
const {
  BYPASS_ENVIRONMENT_VARIABLE,
  BYPASS_TRUST_ENVIRONMENT_VARIABLE,
  bypassHeaders,
  checkProduction,
} = await import(
  new URL("../scripts/operations/check-production.mjs", import.meta.url).href
) as SmokeScript

const repositoryRoot = path.resolve(import.meta.dirname, "..")
const workflowFile = ".github/workflows/preview-smoke.yml"
const bypassSecretReference = "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets."
const trustGate = "steps.trust.outputs.trusted == 'true'"

function readWorkflow() {
  return readFileSync(path.join(repositoryRoot, workflowFile), "utf8")
}

// Steps begin at six spaces and everything inside one is indented further, so
// splitting before a six-space list item is unambiguous -- including inside the
// `script: |` and `run: |` blocks, whose lines all start at ten or twelve.
function workflowSteps(workflow: string) {
  return workflow.split(/\n(?=      - )/u).filter((chunk) => /^ {6}- name:/u.test(chunk))
}

function stepName(step: string) {
  return /^ {6}- name: (.+)$/mu.exec(step)?.[1] ?? ""
}

function stepCondition(step: string) {
  return /^ {8}if: (.+)$/mu.exec(step)?.[1] ?? ""
}

// The `env:` mapping of one step: its entries sit at ten spaces, and so do the
// comments between them, so both are kept and the block ends at the first line
// that returns to eight.
function stepEnvironment(step: string) {
  const marker = "\n        env:\n"
  const start = step.indexOf(marker)
  if (start === -1) return ""

  const kept: string[] = []
  for (const line of step.slice(start + marker.length).split("\n")) {
    if (!/^ {10}/u.test(line)) break
    kept.push(line)
  }

  return kept.join("\n")
}

// The body of the one `script: |` block, dedented so it can be run. Blank lines
// inside the block carry no indentation, so they are kept and the block ends at
// the first non-blank line that is indented less than twelve.
function classificationScript(workflow: string) {
  const marker = "\n          script: |\n"
  const start = workflow.indexOf(marker)
  expect(start).toBeGreaterThan(-1)

  const kept: string[] = []
  for (const line of workflow.slice(start + marker.length).split("\n")) {
    if (line.trim() === "") {
      kept.push("")
      continue
    }
    if (!/^ {12}/u.test(line)) break
    kept.push(line.slice(12))
  }

  return kept.join("\n").trimEnd()
}

type Outputs = Record<string, string>

interface ClassificationApi {
  branchHeads?: string[]
  comparisonStatus?: string
  failWith?: string
}

// Runs the workflow's own classification source the way actions/github-script
// does -- as the body of an async function with `context`, `github` and `core`
// in scope, which is what makes a bare `return` legal in it.
async function classify(payload: unknown, api: ClassificationApi) {
  const outputs: Outputs = {}
  const calls: string[] = []

  const respond = <T,>(value: T) => {
    if (api.failWith) throw new Error(api.failWith)
    return Promise.resolve({ data: value })
  }

  const github = {
    rest: {
      repos: {
        compareCommitsWithBasehead: (options: { basehead: string }) => {
          calls.push(`compare ${options.basehead}`)
          return respond({ status: api.comparisonStatus ?? "diverged" })
        },
        listBranchesForHeadCommit: (options: { commit_sha: string }) => {
          calls.push(`branches ${options.commit_sha}`)
          return respond((api.branchHeads ?? []).map((name) => ({ name })))
        },
      },
    },
  }

  const core = {
    notice: () => {},
    setOutput: (name: string, value: string) => {
      outputs[name] = value
    },
    warning: () => {},
  }

  const context = { payload, repo: { owner: "ntshgarg", repo: "smba-student-portal" } }

  const run = new Function(
    "context",
    "github",
    "core",
    `return (async () => {\n${classificationScript(readWorkflow())}\n})()`,
  ) as (context: unknown, github: unknown, core: unknown) => Promise<void>

  await run(context, github, core)

  return { calls, outputs }
}

const forkSha = "a".repeat(40)
const branchSha = "b".repeat(40)

function deploymentPayload(sha: string) {
  return {
    deployment: { environment: "Preview", sha, task: "deploy" },
    repository: { default_branch: "main" },
  }
}

describe("preview-smoke only spends the bypass secret on trusted code", () => {
  it("gates every step holding the bypass secret on the trust classification", () => {
    const holdingTheSecret = workflowSteps(readWorkflow())
      .filter((step) => stepEnvironment(step).includes(bypassSecretReference))

    // Non-vacuous: if the secret stops appearing in any step's env, this test
    // has stopped asserting anything and should be revisited rather than pass.
    expect(holdingTheSecret.map((step) => stepName(step))).toEqual([
      "Check the bypass secret is configured",
      "Verify the preview answers",
    ])
    for (const step of holdingTheSecret) {
      expect(stepCondition(step)).toContain(trustGate)
    }
  })

  it("passes the classification into the smoke script rather than a literal", () => {
    const workflow = readWorkflow()
    const verify = workflowSteps(workflow)
      .find((step) => stepName(step) === "Verify the preview answers") ?? ""

    // The second lock. A workflow-only gate is one deleted `if:` away from
    // leaking again, so the script is told what the classification was and
    // refuses on anything but "true" -- including the empty string an absent
    // step output renders to.
    expect(stepEnvironment(verify))
      .toContain(`${BYPASS_TRUST_ENVIRONMENT_VARIABLE}: \${{ steps.trust.outputs.trusted }}`)
    expect(workflow).not.toMatch(
      new RegExp(`${BYPASS_TRUST_ENVIRONMENT_VARIABLE}: *(?:"?true"?|'true')`, "u"),
    )
  })

  it("reports an untrusted preview as not verified instead of failing or smoking it", () => {
    const untrustedReport = workflowSteps(readWorkflow())
      .find((step) => stepCondition(step) === "steps.trust.outputs.trusted != 'true'") ?? ""

    expect(untrustedReport).toContain("Preview NOT verified")
    expect(untrustedReport).toContain("GITHUB_STEP_SUMMARY")
    expect(untrustedReport).not.toContain(BYPASS_ENVIRONMENT_VARIABLE)
    expect(untrustedReport).not.toContain("exit 1")
  })

  it("still checks out trusted code, which is the half #131 closed", () => {
    const workflow = readWorkflow()
    const checkouts = workflowSteps(workflow).filter((step) => step.includes("uses: actions/checkout"))

    expect(checkouts).toHaveLength(1)
    expect(checkouts[0]).toContain("ref: ${{ github.event.repository.default_branch }}")
    // The deployed SHA may be read inside the classification script, where it is
    // a payload field; it may never be pasted into the workflow as an
    // expression, which is how it would reach a checkout or a shell again.
    expect(workflow).not.toContain("${{ github.event.deployment.sha }}")
  })
})

describe("the classification the workflow runs", () => {
  it("trusts a commit that is the head of a branch of this repository", async () => {
    const { calls, outputs } = await classify(deploymentPayload(branchSha), {
      branchHeads: ["fix/ci-fork-preview-gate"],
    })

    expect(outputs.trusted).toBe("true")
    // A branch head settles it, so no comparison is needed.
    expect(calls).toEqual([`branches ${branchSha}`])
  })

  it("trusts a commit that is already on the default branch", async () => {
    const { calls, outputs } = await classify(deploymentPayload(branchSha), {
      branchHeads: [],
      comparisonStatus: "ahead",
    })

    expect(outputs.trusted).toBe("true")
    expect(calls).toEqual([`branches ${branchSha}`, `compare ${branchSha}...main`])
  })

  it("refuses a fork commit, which is present here but on no branch here", async () => {
    // GitHub replicates a fork pull request's head commit into the base
    // repository under refs/pull/N/head, so it is readable and comparable. What
    // it is not is the head of a branch, and it is diverged from main.
    const { outputs } = await classify(deploymentPayload(forkSha), {
      branchHeads: [],
      comparisonStatus: "diverged",
    })

    expect(outputs.trusted).toBe("false")
    expect(outputs.reason).toContain("on no branch")
  })

  it("refuses a deployment carrying no full commit SHA, without asking GitHub", async () => {
    const { calls, outputs } = await classify(deploymentPayload("HEAD"), { branchHeads: ["main"] })

    expect(outputs.trusted).toBe("false")
    expect(calls).toEqual([])
  })

  it("classifies as untrusted when the API fails, rather than throwing", async () => {
    const { outputs } = await classify(deploymentPayload(branchSha), {
      failWith: "Bad credentials",
    })

    // Fails closed on the secret and green on the check: a red mark that no
    // commit can fix is the thing this workflow already refuses to produce.
    expect(outputs.trusted).toBe("false")
    expect(outputs.reason).toContain("Bad credentials")
  })
})

describe("the smoke script's own refusal", () => {
  const previewOrigin = new URL("https://smba-student-portal-git-fork.vercel.app")
  const loopbackOrigin = new URL("http://127.0.0.1:4000")
  const secret = { [BYPASS_ENVIRONMENT_VARIABLE]: "bypass-token" }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("sends the header once the caller affirms the deployment is trusted", () => {
    expect(bypassHeaders(previewOrigin, { ...secret, [BYPASS_TRUST_ENVIRONMENT_VARIABLE]: "true" }))
      .toEqual({ "x-vercel-protection-bypass": "bypass-token" })
  })

  it.each([
    ["absent", {}],
    ["false", { [BYPASS_TRUST_ENVIRONMENT_VARIABLE]: "false" }],
    ["empty, as an unset step output renders", { [BYPASS_TRUST_ENVIRONMENT_VARIABLE]: "" }],
    ["not exactly true", { [BYPASS_TRUST_ENVIRONMENT_VARIABLE]: "TRUE" }],
  ])("refuses a remote deployment when the affirmation is %s", (_label, environment) => {
    expect(() => bypassHeaders(previewOrigin, { ...secret, ...environment }))
      .toThrow(new RegExp(`${BYPASS_TRUST_ENVIRONMENT_VARIABLE}`, "u"))
  })

  it("keeps the header off the wire entirely, rather than sending an empty one", async () => {
    // Stubbed rather than observed, so that a build without the gate fails this
    // test instead of quietly reaching a real vercel.app host from the suite.
    const fetchCalls = vi.spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("no request should leave this test"))

    await expect(checkProduction(previewOrigin.origin, { attempts: 3, environment: secret }))
      .rejects.toThrow(/is only given to a deployment built from code this repository trusts/u)
    // Refused before the first request, and not retried three times over it.
    expect(fetchCalls).not.toHaveBeenCalled()
  })

  it("sends nothing and refuses nothing when no bypass secret is configured", () => {
    expect(bypassHeaders(previewOrigin, {})).toEqual({})
    expect(bypassHeaders(previewOrigin, { [BYPASS_ENVIRONMENT_VARIABLE]: "  " })).toEqual({})
  })

  it("exempts a loopback origin, which is this machine and not a deployment", () => {
    // The gate protects a third party's deployment from being handed the
    // credential. A loopback server is the caller's own process -- and it is
    // what tests/production-smoke.test.ts points the script at.
    expect(bypassHeaders(loopbackOrigin, secret))
      .toEqual({ "x-vercel-protection-bypass": "bypass-token" })
  })
})
