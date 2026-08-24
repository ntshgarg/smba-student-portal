import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import {
  accessibilityAdvisoryBaselinePath,
  accessibilityAdvisoryCountsByRule,
  accessibilityAdvisoryIncreases,
  readAccessibilityAdvisoryBaseline,
  type AccessibilityAdvisoryBaseline,
  type AccessibilityResult,
} from "../../tests/e2e/support/accessibility-audit"
import { accessibilityProfiles } from "../../tests/e2e/support/accessibility-matrix"

// This script is the only writer of the baseline, so the documentation line
// lives here rather than in the file it produces; a hand-edited copy that still
// parses is overwritten on the next run, and one that does not is refused below
// rather than replaced.
const DOCUMENTATION = "Ratchet baseline for the accessibility advisories that are not promoted to"
  + " blocking findings, counted per axe rule id per profile. null means the profile has never been"
  + " recorded and fails the gate until it is. Record or re-record with:"
  + " npx tsx scripts/regression/update-accessibility-advisory-baseline.ts — which refuses to write"
  + " when a recorded count would rise, unless it is passed --allow-increase."

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const root = path.resolve(argument("--root") ?? "output/accessibility")
// A ratchet that re-records whatever it observes is not a ratchet: the command
// the baseline's own documentation tells operators to run would launder a
// regression into the recorded ceiling, and the only guard left would be a human
// noticing the JSON diff. Raising a ceiling stays possible — sometimes a rule
// legitimately covers more surface — but it has to be asked for, and the rules
// that rose are printed either way so the reason lands in the PR.
const allowIncrease = process.argv.includes("--allow-increase")

const baselineExists = existsSync(accessibilityAdvisoryBaselinePath)
const { baseline, problem } = baselineExists
  ? readAccessibilityAdvisoryBaseline()
  : { baseline: { profiles: {} } satisfies AccessibilityAdvisoryBaseline, problem: null }

// Read through the gate's own validator, so a file this script cannot parse is a
// file the gate cannot parse either. Overwriting it would erase ceilings we were
// unable to compare against, which is the same laundering by another route.
if (problem) {
  process.stderr.write(`Refusing to overwrite ${accessibilityAdvisoryBaselinePath}: ${problem}.\n`
    + "Repair or delete the file by hand — rewriting it here would erase recorded ceilings"
    + " this script could not read.\n")
  process.exit(1)
}

const existing = baseline.profiles
const profiles: AccessibilityAdvisoryBaseline["profiles"] = {}
const unrecorded: string[] = []
const recorded: string[] = []

for (const profile of accessibilityProfiles) {
  const resultPath = path.join(root, profile, "results.sanitized.json")
  if (!existsSync(resultPath)) {
    // A run of one profile must not erase the other two, so an absent result
    // file keeps whatever was recorded before — including null.
    profiles[profile] = existing[profile] ?? null
    if (!profiles[profile]) unrecorded.push(profile)
    continue
  }
  const results = JSON.parse(readFileSync(resultPath, "utf8")) as AccessibilityResult[]
  // Keyed off result.profile, the same field accessibilityAdvisoryRegressions
  // groups by, so the recorded number cannot disagree with the number checked.
  const counts = accessibilityAdvisoryCountsByRule(
    results.filter((result) => result.profile === profile),
  )
  profiles[profile] = counts
  const occurrences = Object.values(counts).reduce((total, count) => total + count, 0)
  recorded.push(`${profile}: ${Object.keys(counts).length} rules / ${occurrences} advisories`)
}

// Asked of the whole recording at once, through the gate's own comparison, so the
// writer and the gate cannot disagree about what a rise is.
const increases = accessibilityAdvisoryIncreases(existing, profiles)

if (increases.length && !allowIncrease) {
  process.stderr.write(`${[
    `Refusing to write ${accessibilityAdvisoryBaselinePath}: ${increases.length} recorded`
      + " ceiling(s) would rise.",
    ...increases.map((line) => `  ${line}`),
    "A ratchet only moves down. Fix the regression, or re-run with --allow-increase and say in the"
      + " PR why the higher number is the right one.",
  ].join("\n")}\n`)
  process.exit(1)
}

writeFileSync(
  accessibilityAdvisoryBaselinePath,
  `${JSON.stringify({ documentation: DOCUMENTATION, profiles }, null, 2)}\n`,
)

process.stdout.write(`${[
  `Wrote ${accessibilityAdvisoryBaselinePath}`,
  ...recorded.map((line) => `  ${line}`),
  ...unrecorded.map((profile) => `  ${profile}: still unrecorded — no ${path.join(root, profile, "results.sanitized.json")}`),
  // Printed even on the allowed path: --allow-increase is a decision, and a
  // decision that leaves no trace in the run log is one nobody can review.
  ...increases.length
    ? ["  Ceilings raised under --allow-increase:", ...increases.map((line) => `    ${line}`)]
    : [],
].join("\n")}\n`)

if (unrecorded.length) process.exitCode = 1
