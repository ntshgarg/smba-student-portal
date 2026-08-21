import { test } from "@playwright/test"
import type { BrowserContext, Page } from "@playwright/test"

import { captureDefinitions, viewportsForCapture } from "./support/capture-matrix"
import {
  artifactPath,
  evidenceFilePath,
  prepareCaptureDirectories,
  writeCaptureEvidence,
  writeRunReports,
} from "./support/capture-report"
import {
  authenticateAndNavigate,
  captureFailureScreenshot,
  captureScreenshots,
  closeContext,
  collectDomEvidence,
  collectPerformanceEvidence,
  createActorContext,
  evidenceViolations,
  executeCaptureAction,
  PageEvidenceCollector,
  settlePage,
} from "./support/capture-runtime"
import { captureSettings, resolveCaptureRoute } from "./support/capture-settings"
import type {
  CaptureEvidence,
  CaptureResult,
} from "./support/capture-types"

const results: CaptureResult[] = []

const definitions = captureDefinitions.filter((definition) => {
  if (!captureSettings.actors.includes(definition.actor)) return false
  if (definition.scenarios && !definition.scenarios.includes(captureSettings.scenario)) return false
  if (
    captureSettings.onlyCaptureIds.size
    && !captureSettings.onlyCaptureIds.has(definition.id)
  ) return false
  return true
})

const cases = definitions.flatMap((definition) => (
  viewportsForCapture(definition, captureSettings.viewportSet)
    .map((viewport) => ({ definition, viewport }))
))

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.stack ?? error.message
  return String(error)
}

function collectorEvidence(
  evidence: CaptureEvidence,
  collector: PageEvidenceCollector | undefined,
) {
  if (!collector) return
  evidence.console = [...collector.console]
  evidence.httpErrors = [...collector.httpErrors]
  evidence.network = [...collector.network]
  evidence.pageErrors = [...collector.pageErrors]
  evidence.requestFailures = [...collector.requestFailures]
}

test.describe("authenticated responsive regression capture", () => {
  test.beforeAll(async () => {
    await prepareCaptureDirectories()
  })

  test.afterAll(async () => {
    await writeRunReports(results)
  })

  for (const captureCase of cases) {
    const { definition, viewport } = captureCase
    const captureKey = `${definition.id}-${viewport.label}`
    const title = `${definition.id} · ${viewport.width}×${viewport.height}`

    test(title, async ({ browser }, testInfo) => {
      const startedAt = new Date()
      const clockStartedAt = Date.now()
      const evidencePath = evidenceFilePath(captureKey)
      const evidence: CaptureEvidence = {
        actions: [],
        artifacts: [],
        console: [],
        dom: null,
        error: null,
        httpErrors: [],
        network: [],
        pageErrors: [],
        performance: null,
        requestFailures: [],
      }
      let captureMs = 0
      let context: BrowserContext | undefined
      let collector: PageEvidenceCollector | undefined
      let page: Page | undefined
      let settleMs = 0
      let thrown: unknown = null

      try {
        context = await createActorContext(browser, definition.actor, viewport)
        page = await context.newPage()
        collector = new PageEvidenceCollector(page)

        await authenticateAndNavigate(page, definition.actor, definition.route)
        settleMs += await settlePage(page, true)
        for (const action of definition.actions ?? []) {
          const durationMs = await executeCaptureAction(page, action)
          evidence.actions.push({ action, durationMs })
          settleMs += durationMs
        }

        const screenshots = await captureScreenshots(
          page,
          definition,
          viewport,
          captureKey,
        )
        captureMs = screenshots.captureMs
        evidence.artifacts.push(...screenshots.artifacts)
        evidence.dom = await collectDomEvidence(page)
        evidence.performance = await collectPerformanceEvidence(
          page,
          captureMs,
          settleMs,
          Date.now() - clockStartedAt,
        )
        await collector.flush()
        collectorEvidence(evidence, collector)

        const violations = evidenceViolations(evidence)
        if (captureSettings.strict && violations.length) {
          throw new Error(`Strict capture evidence failed:\n- ${violations.join("\n- ")}`)
        }
      } catch (error) {
        thrown = error
        evidence.error = errorMessage(error)
        if (page && !page.isClosed()) {
          const failureArtifact = await captureFailureScreenshot(page, captureKey).catch(() => null)
          if (failureArtifact) evidence.artifacts.push(failureArtifact)
          if (!evidence.dom) {
            evidence.dom = await collectDomEvidence(page).catch(() => null)
          }
          if (!evidence.performance) {
            evidence.performance = await collectPerformanceEvidence(
              page,
              captureMs,
              settleMs,
              Date.now() - clockStartedAt,
            ).catch(() => null)
          }
        }
      } finally {
        collector?.stop()
        await collector?.flush()
        collectorEvidence(evidence, collector)
        const violations = evidenceViolations(evidence)
        if (thrown && !violations.length) {
          violations.push(`capture execution: ${errorMessage(thrown).split("\n")[0]}`)
        }
        await writeCaptureEvidence(evidencePath, evidence)
        const result: CaptureResult = {
          actor: definition.actor,
          description: definition.description,
          evidencePath: artifactPath(evidencePath),
          finishedAt: new Date().toISOString(),
          id: definition.id,
          route: resolveCaptureRoute(definition.route),
          scenario: captureSettings.scenario,
          startedAt: startedAt.toISOString(),
          status: thrown ? "failed" : "passed",
          testTitle: title,
          viewport,
          violations,
        }
        results.push(result)
        await testInfo.attach("capture-evidence", {
          contentType: "application/json",
          path: evidencePath,
        })
        await closeContext(context)
      }

      if (thrown) throw thrown
    })
  }
})
