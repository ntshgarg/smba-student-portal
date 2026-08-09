import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { captureDefinitions, viewportsForCapture } from "./capture-matrix"
import { captureSettings } from "./capture-settings"
import type {
  CaptureDefinition,
  CaptureEvidence,
  CaptureResult,
} from "./capture-types"

function relativeToRun(filePath: string) {
  return path.relative(captureSettings.runDir, filePath).split(path.sep).join("/")
}

function markdownCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}

export async function prepareCaptureDirectories() {
  await Promise.all([
    mkdir(path.join(captureSettings.runDir, "evidence"), { recursive: true }),
    mkdir(path.join(captureSettings.runDir, "screenshots"), { recursive: true }),
  ])
}

export function evidenceFilePath(captureKey: string) {
  return path.join(captureSettings.runDir, "evidence", `${captureKey}.json`)
}

export function screenshotFilePath(fileName: string) {
  return path.join(captureSettings.runDir, "screenshots", fileName)
}

export function artifactPath(filePath: string) {
  return relativeToRun(filePath)
}

export async function writeCaptureEvidence(filePath: string, evidence: CaptureEvidence) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8")
}

function selectedDefinitions() {
  return captureDefinitions.filter((definition) => {
    if (!captureSettings.actors.includes(definition.actor)) return false
    if (definition.scenarios && !definition.scenarios.includes(captureSettings.scenario)) return false
    if (
      captureSettings.onlyCaptureIds.size
      && !captureSettings.onlyCaptureIds.has(definition.id)
    ) return false
    return true
  })
}

function expectedEntries(definitions: CaptureDefinition[]) {
  return definitions.flatMap((definition) => viewportsForCapture(definition).map((viewport) => ({
    actor: definition.actor,
    captureId: definition.id,
    description: definition.description,
    route: definition.route,
    viewport,
  })))
}

function reportMarkdown(results: CaptureResult[]) {
  const failures = results.filter((result) => result.status === "failed")
  const overflowFailures = results.filter((result) => result.violations.some((item) => (
    item.includes("horizontal document overflow")
  )))
  const fixture = captureSettings.fixtureSummary
  const fixtureCounts = fixture?.counts && typeof fixture.counts === "object"
    ? JSON.stringify(fixture.counts)
    : null
  const lines = [
    `# Mobile regression capture: ${captureSettings.runLabel}`,
    "",
    `- Scenario: \`${captureSettings.scenario}\``,
    `- Revision: \`${captureSettings.revision}\``,
    `- Base URL: \`${captureSettings.baseURL}\``,
    `- Reference date: \`${captureSettings.referenceDate}\``,
    `- Report month: \`${captureSettings.reportMonth}\``,
    `- Browser: system Chrome`,
    `- Strict evidence checks: \`${captureSettings.strict}\``,
    ...(fixture?.scenario ? [`- Fixture stage: \`${String(fixture.scenario)}\``] : []),
    ...(fixture?.checksum ? [`- Fixture checksum: \`${String(fixture.checksum)}\``] : []),
    ...(fixtureCounts ? [`- Fixture counts: \`${fixtureCounts}\``] : []),
    `- Captures: ${results.length - failures.length} passed, ${failures.length} failed`,
    `- Horizontal overflow failures: ${overflowFailures.length}`,
    "",
    "| Capture | Actor | Viewport | Status | Violations | Evidence |",
    "| --- | --- | --- | --- | --- | --- |",
  ]

  for (const result of [...results].sort((first, second) => (
    first.id.localeCompare(second.id) || first.viewport.width - second.viewport.width
  ))) {
    lines.push([
      markdownCell(result.id),
      result.actor,
      `${result.viewport.width}×${result.viewport.height}`,
      result.status,
      markdownCell(result.violations.join("; ") || "—"),
      `[JSON](${markdownCell(result.evidencePath)})`,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"))
  }

  lines.push("")
  return `${lines.join("\n")}\n`
}

export async function writeRunReports(results: CaptureResult[]) {
  const definitions = selectedDefinitions()
  const sortedResults = [...results].sort((first, second) => (
    first.id.localeCompare(second.id) || first.viewport.width - second.viewport.width
  ))
  const failures = sortedResults.filter((result) => result.status === "failed")
  const aggregate = {
    captures: sortedResults.length,
    failed: failures.length,
    horizontalOverflow: sortedResults.filter((result) => result.violations.some((violation) => (
      violation.includes("horizontal document overflow")
    ))).length,
    passed: sortedResults.length - failures.length,
    violations: sortedResults.reduce((total, result) => total + result.violations.length, 0),
  }
  const generatedAt = new Date().toISOString()
  const manifest = {
    schemaVersion: 1,
    run: {
      actors: captureSettings.actors,
      baseURL: captureSettings.baseURL,
      browserChannel: "chrome",
      fixture: captureSettings.fixtureSummary,
      generatedAt,
      label: captureSettings.runLabel,
      referenceDate: captureSettings.referenceDate,
      reportMonth: captureSettings.reportMonth,
      revision: captureSettings.revision,
      scenario: captureSettings.scenario,
      strict: captureSettings.strict,
    },
    expected: expectedEntries(definitions),
    results: sortedResults,
  }
  const report = {
    schemaVersion: 1,
    aggregate,
    generatedAt,
    failures,
    results: sortedResults,
  }

  await prepareCaptureDirectories()
  await Promise.all([
    writeFile(
      path.join(captureSettings.runDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(captureSettings.runDir, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(captureSettings.runDir, "report.md"),
      reportMarkdown(sortedResults),
      "utf8",
    ),
  ])
}
