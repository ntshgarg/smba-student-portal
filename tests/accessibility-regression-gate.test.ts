import { closeSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  accessibilityAdvisoryBaselinePath,
  accessibilityAdvisoryCountsByRule,
  accessibilityAdvisoryIncreases,
  accessibilityAdvisoryRegressions,
  buildAccessibilitySummary,
  formatAccessibilityFailures,
  promoteBlockingAdvisories,
  sanitizeAccessibilityText,
  type AccessibilityAdvisory,
  type AccessibilityResult,
} from "./e2e/support/accessibility-audit"
import { assertDisposableAccessibilityDatabase } from "./e2e/support/accessibility-environment"
import {
  accessibilityProfiles,
  accessibilityStates,
  accessibilityViewports,
  statesForProfile,
  viewportsForState,
  type AccessibilityProfile,
} from "./e2e/support/accessibility-matrix"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function resultWithFinding(): AccessibilityResult {
  return {
    actor: "guest",
    description: "Test state",
    findings: [{
      id: "button-name",
      impact: "critical",
      message: "Button has no accessible name",
      source: "axe",
      targets: ["button"],
    }],
    id: "test-state",
    profile: "admin",
    route: "/test",
    title: "Test",
    url: "http://127.0.0.1/test",
    viewport: accessibilityViewports[0],
  }
}

function advisory(id: string, category: AccessibilityAdvisory["category"] = "needs-review") {
  return { category, id, impact: "moderate", message: `${id} could not be resolved`, source: "axe" } as const
}

function resultWithAdvisories(
  profile: AccessibilityProfile,
  advisories: readonly AccessibilityAdvisory[],
): AccessibilityResult {
  return {
    ...resultWithFinding(),
    advisories: [...advisories],
    findings: [],
    profile,
  }
}

describe("accessibility regression matrix", () => {
  it("uses unique state identifiers and covers every database profile", () => {
    const ids = accessibilityStates.map((state) => state.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const profile of accessibilityProfiles) {
      expect(statesForProfile(profile).length).toBeGreaterThan(0)
    }
  })

  it("runs each state at web, tablet, and mobile widths", () => {
    for (const state of accessibilityStates) {
      const widths = viewportsForState(state).map((viewport) => viewport.width)
      expect(widths).toEqual(expect.arrayContaining([1440, 820, 390]))
      if (state.compact) expect(widths).toContain(320)
    }
  })

  it("keeps the approved authentication and role surfaces in the matrix", () => {
    const ids = new Set(accessibilityStates.map((state) => state.id))
    for (const id of [
      "admin-authenticator-reconnect",
      "admin-authenticator-recovery-approval",
      "admin-recovery-email-setup",
      "authenticator-verification",
      "head-coach-setup-unavailable",
      "junior-coach-personal-attendance",
      "player-announcement-detail",
      "player-attendance",
      "player-pin-setup",
    ]) {
      expect(ids.has(id), `${id} is missing from the accessibility matrix`).toBe(true)
    }
  })
})

describe("accessibility evidence", () => {
  it("redacts email addresses, long secrets, and sensitive URL parameters", () => {
    const source = "person@example.com ABCDEFGHIJKLMNOPQRSTUVWXYZ234567 token=secret-value PIN: 246810 password=hunter2"
    const sanitized = sanitizeAccessibilityText(source)
    expect(sanitized).not.toContain("person@example.com")
    expect(sanitized).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
    expect(sanitized).not.toContain("secret-value")
    expect(sanitized).not.toContain("246810")
    expect(sanitized).not.toContain("hunter2")
  })

  it("aggregates failures and creates a concise GitHub summary", () => {
    const result = resultWithFinding()
    expect(formatAccessibilityFailures([result])).toEqual([
      "test-state · web · critical · button-name: Button has no accessible name [button]",
    ])
    expect(buildAccessibilitySummary([result], [])).toContain("- Findings: 1")
    expect(buildAccessibilitySummary([{ ...result, findings: [] }], []))
      .toContain("All audited states passed")
  })
})

describe("accessibility advisory gate", () => {
  it("promotes the blocking rule ids and leaves everything else advisory", () => {
    const { blocking, remaining } = promoteBlockingAdvisories([
      advisory("color-contrast"),
      advisory("region", "best-practice"),
      advisory("target-size"),
      advisory("aria-hidden-focus", "best-practice-needs-review"),
    ])
    expect(blocking.map((item) => item.id))
      .toEqual(["color-contrast", "region", "aria-hidden-focus"])
    expect(remaining.map((item) => item.id)).toEqual(["target-size"])
    // The category has to survive: it is the difference between axe proving a
    // failure and axe declining to decide.
    expect(blocking[0].message).toBe("needs-review: color-contrast could not be resolved")
  })

  it("counts advisories per rule id across every audited state", () => {
    expect(accessibilityAdvisoryCountsByRule([
      resultWithAdvisories("admin", [advisory("region"), advisory("region"), advisory("target-size")]),
      resultWithAdvisories("admin", [advisory("region")]),
    ])).toEqual({ region: 3, "target-size": 1 })
  })

  it("fails only when a rule rises above its recorded baseline", () => {
    const results = [resultWithAdvisories("admin", [advisory("target-size"), advisory("target-size")])]
    expect(accessibilityAdvisoryRegressions(results, { profiles: { admin: { "target-size": 2 } } }))
      .toEqual([])
    expect(accessibilityAdvisoryRegressions(results, { profiles: { admin: { "target-size": 5 } } }))
      .toEqual([])
    expect(accessibilityAdvisoryRegressions(results, { profiles: { admin: { "target-size": 1 } } }))
      .toEqual(["admin · target-size: 2 advisories exceed the recorded baseline of 1"])
  })

  it("fails safe on a rule or a profile the baseline has never recorded", () => {
    const results = [resultWithAdvisories("admin", [advisory("target-size")])]
    expect(accessibilityAdvisoryRegressions(results, { profiles: { admin: {} } }))
      .toEqual(["admin · target-size: 1 advisories exceed the recorded baseline of 0"])
    expect(accessibilityAdvisoryRegressions(results, { profiles: { admin: null } }))
      .toEqual([expect.stringContaining("admin · advisory baseline never recorded")])
    expect(accessibilityAdvisoryRegressions(results, { profiles: {} }))
      .toEqual([expect.stringContaining("admin · advisory baseline never recorded")])
  })

  it("fails a profile whose run was clean but whose baseline was never recorded", () => {
    // The hazard the ratchet exists for: filtering the audited profiles down to
    // the ones that produced an advisory would let this run skip the baseline
    // lookup and pass on no evidence at all.
    const clean = { ...resultWithAdvisories("stress", []), advisories: [] }
    expect(accessibilityAdvisoryRegressions([clean], { profiles: { stress: null } }))
      .toEqual([expect.stringContaining("stress · advisory baseline never recorded")])
    expect(accessibilityAdvisoryRegressions([clean], { profiles: {} }))
      .toEqual([expect.stringContaining("stress · advisory baseline never recorded")])
    // A profile recorded as empty is a claim that it has no advisories, and a
    // clean run keeps that claim true, so this one passes.
    expect(accessibilityAdvisoryRegressions([clean], { profiles: { stress: {} } })).toEqual([])
  })

  it("reports the ratchet in the summary even when the run produced no advisories", () => {
    // advisorySummaryLines returns nothing without advisories to tabulate, so the
    // ratchet has to be its own section or a never-recorded profile fails the gate
    // with a summary that says only "no findings".
    const summary = buildAccessibilitySummary(
      [{ ...resultWithAdvisories("stress", []), advisories: [] }],
      ["stress · advisory baseline never recorded"],
    )
    expect(summary).toContain("❌ No findings, but the advisory ratchet below failed.")
    expect(summary).toContain("### Advisory ratchet")
    expect(summary).toContain("- stress · advisory baseline never recorded")
  })

  it("refuses to re-record a ceiling that would rise, and lets one fall", () => {
    const previous = { admin: { region: 4, "target-size": 2 }, clean: null }
    expect(accessibilityAdvisoryIncreases(previous, { admin: { region: 4, "target-size": 2 } }))
      .toEqual([])
    expect(accessibilityAdvisoryIncreases(previous, { admin: { region: 1 } })).toEqual([])
    expect(accessibilityAdvisoryIncreases(previous, { admin: { region: 4, "target-size": 11 } }))
      .toEqual(["admin · target-size: 2 → 11"])
    // A rule the baseline has never seen has a ceiling of zero, matching the gate.
    expect(accessibilityAdvisoryIncreases(previous, { admin: { "dup-id": 1 } }))
      .toEqual(["admin · dup-id: 0 → 1"])
    // A profile that was never recorded has no ceiling to raise.
    expect(accessibilityAdvisoryIncreases(previous, { clean: { region: 90 } })).toEqual([])
  })

  it("keeps every profile present in the checked-in baseline", () => {
    const baseline = JSON.parse(readFileSync(accessibilityAdvisoryBaselinePath, "utf8")) as {
      profiles: Record<string, Record<string, number> | null>
    }
    for (const profile of accessibilityProfiles) {
      expect(Object.hasOwn(baseline.profiles, profile), `${profile} is missing from the baseline`).toBe(true)
    }
  })
})

describe("accessibility database guard", () => {
  it("accepts only an existing accessibility database under the system temp directory", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "smba-a11y-guard-"))
    temporaryDirectories.push(directory)
    const database = path.join(directory, "smba-a11y-test.db")
    closeSync(openSync(database, "w", 0o600))
    expect(assertDisposableAccessibilityDatabase(database)).toBe(realpathSync(database))
  })

  it("accepts a guarded accessibility database under the portable /tmp root", () => {
    const directory = mkdtempSync("/tmp/smba-a11y-guard-")
    temporaryDirectories.push(directory)
    const database = path.join(directory, "smba-accessibility-test.db")
    closeSync(openSync(database, "w", 0o600))
    expect(assertDisposableAccessibilityDatabase(database)).toBe(realpathSync(database))
  })

  it("rejects relative and non-temporary database paths", () => {
    expect(() => assertDisposableAccessibilityDatabase(".data/academy-clean.db"))
      .toThrow("must be an absolute path")
    expect(() => assertDisposableAccessibilityDatabase(path.resolve("package.json")))
      .toThrow("system temporary directory")
  })
})
