import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import {
  accessibilityAdvisoryRegressions,
  buildAccessibilitySummary,
  type AccessibilityResult,
} from "../../tests/e2e/support/accessibility-audit"
import { accessibilityProfiles } from "../../tests/e2e/support/accessibility-matrix"

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const root = path.resolve(argument("--root") ?? "output/accessibility")
const output = argument("--output")
const missingProfiles: string[] = []
const results = accessibilityProfiles.flatMap((profile) => {
  const resultPath = path.join(root, profile, "results.sanitized.json")
  if (!existsSync(resultPath)) {
    missingProfiles.push(profile)
    return []
  }
  return JSON.parse(readFileSync(resultPath, "utf8")) as AccessibilityResult[]
})

const missingCopy = missingProfiles.length
  ? `\n❌ Missing profiles: ${missingProfiles.join(", ")}\n`
  : ""
// Computed once and handed to the summary, so the ratchet section printed below
// and the exit code set at the bottom are the same list rather than two reads of
// the baseline file that could disagree if it changed mid-step.
const regressions = accessibilityAdvisoryRegressions(results)
const summary = results.length
  ? `${buildAccessibilitySummary(results, regressions)}${missingCopy}`
  : "## UI accessibility / WCAG 2.2 AA\n\n❌ No accessibility results were produced.\n"

if (output) writeFileSync(path.resolve(output), summary, { flag: "a", mode: 0o600 })
else process.stdout.write(summary)

// buildAccessibilitySummary already prints the ratchet breaches; this keeps the
// step's exit code agreeing with what its own summary says.
if (missingProfiles.length
  || !results.length
  || results.some((result) => result.findings.length > 0)
  || regressions.length) {
  process.exitCode = 1
}
