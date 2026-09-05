import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  accessibilityAdvisoryBaselinePath,
  accessibilityAdvisoryClockMismatch,
  accessibilityAdvisoryCountsByRule,
  accessibilityAdvisoryIncreases,
  accessibilityAdvisoryRegressions,
  buildAccessibilitySummary,
  formatAccessibilityFailures,
  promoteBlockingAdvisories,
  readAccessibilityAdvisoryBaseline,
  readAccessibilityFixtureClock,
  sanitizeAccessibilityText,
  writeAccessibilityResults,
  type AccessibilityAdvisory,
  type AccessibilityAdvisoryBaseline,
  type AccessibilityResult,
} from "./e2e/support/accessibility-audit"
import {
  assertDisposableAccessibilityDatabase,
  assertPinnedFixtureClock,
  assertServerFixtureClock,
} from "./e2e/support/accessibility-environment"
import {
  accessibilityProfiles,
  accessibilityStates,
  accessibilityViewports,
  navigatingAccessibilityInteractions,
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

  it("makes every interaction that changes route say where it lands", () => {
    for (const state of accessibilityStates) {
      if (!state.interaction) continue
      if (!navigatingAccessibilityInteractions.includes(state.interaction)) {
        expect(
          state.interactionRoute,
          `${state.id} declares an interactionRoute for ${state.interaction}, which does not navigate`,
        ).toBeUndefined()
        continue
      }
      expect(
        state.interactionRoute,
        `${state.id} runs ${state.interaction}, which navigates, and declares no interactionRoute`
        + " -- without one the audit records whatever route the click actually reached under this id",
      ).toBeInstanceOf(RegExp)
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
  it("promotes a blocking rule axe decided against, and ratchets one it could not", () => {
    const { blocking, remaining } = promoteBlockingAdvisories([
      advisory("color-contrast"),
      advisory("region", "best-practice"),
      advisory("target-size"),
      advisory("aria-hidden-focus", "best-practice-needs-review"),
    ])
    // Only `region` is both a blocking rule id and a decided result. The two
    // needs-review entries stay advisory however serious their rule: the first
    // run of this gate promoted them and produced 1,184 blocking findings, 1,160
    // of them contrast on elements whose background axe could not resolve. A
    // build cannot go green by fixing a question, so those ratchet instead.
    expect(blocking.map((item) => item.id)).toEqual(["region"])
    expect(remaining.map((item) => item.id))
      .toEqual(["color-contrast", "target-size", "aria-hidden-focus"])
    // The category has to survive: it is the difference between axe proving a
    // failure and axe declining to decide.
    expect(blocking[0].message).toBe("best-practice: region could not be resolved")
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

describe("accessibility fixture clock guard", () => {
  // The instant the workflow actually exports. Reading it from the workflow file
  // rather than repeating it means a future edit that unpins the stress step, or
  // moves it outside the bounds, fails here instead of on a branch that changed
  // no CSS three weeks later.
  const workflow = readFileSync(
    path.resolve(".github/workflows/ui-accessibility.yml"),
    "utf8",
  )
  const configuredInstant = workflow.match(
    /SMBA_ACCESSIBILITY_CLOCK:\s*"([^"]+)"/u,
  )?.[1]

  it("accepts the instant the stress step exports, which stays inside the anchor's month", () => {
    expect(configuredInstant).toBeDefined()
    expect(assertPinnedFixtureClock("stress", configuredInstant)).toBe("2026-08-17")
  })

  it("leaves the profiles whose fixtures follow the runner's own clock alone", () => {
    // admin and clean are seeded at build time from the same clock they are
    // rendered against, so pinning them would freeze nothing and only add a
    // variable somebody has to keep correct.
    expect(assertPinnedFixtureClock("admin", undefined)).toBeNull()
    expect(assertPinnedFixtureClock("clean", undefined)).toBeNull()
    expect(assertPinnedFixtureClock("clean", "  ")).toBeNull()
  })

  it("refuses a non-stress profile whose shell still exports the pin", () => {
    // The quiet version of this finding's own failure. lib/clock.ts pins admin
    // and clean too, so an export left over from a stress run freezes their
    // servers; if this returned null anyway the runner would write
    // `fixtureClock: null` beside a frozen DOM's results, that null would match
    // the null recorded for those profiles, and the gate would compare counts
    // from two different DOMs and say nothing. The docs recipe teaches the
    // export, so the leak is a shell away.
    for (const profile of ["admin", "clean"]) {
      expect(() => assertPinnedFixtureClock(profile, "2026-08-17T09:30:00+05:30"))
        .toThrow(new RegExp(`must not be set for the ${profile} profile`, "u"))
    }
  })

  it("has an answer for every profile the matrix can run, not just the two named above", () => {
    // Every name here is a name lib/clock.ts will pin, because both files gate on
    // lib/accessibility-gate.ts. A fourth profile added to the matrix therefore
    // arrives already exposed to the leak, and this fails until it is handled.
    for (const profile of accessibilityProfiles) {
      if (profile === "stress") continue
      expect(() => assertPinnedFixtureClock(profile, "2026-08-17T09:30:00+05:30"))
        .toThrow("must not be set")
    }
  })

  it("refuses to audit the frozen fixture against an unpinned or unreadable clock", () => {
    expect(() => assertPinnedFixtureClock("stress", undefined))
      .toThrow("SMBA_ACCESSIBILITY_CLOCK is required")
    expect(() => assertPinnedFixtureClock("stress", "   "))
      .toThrow("SMBA_ACCESSIBILITY_CLOCK is required")
    expect(() => assertPinnedFixtureClock("stress", "a fortnight after the anchor"))
      .toThrow("not a parsable instant")
  })

  it("refuses a pin that would audit less than the gate audits today", () => {
    // Pinning at the anchor is the tempting answer -- it is self-consistent and
    // it does stop the drift -- but the fixture records attendance on every day
    // up to that date, so the August ledger would render no "not recorded" cell
    // and the gate would quietly stop watching that colour.
    expect(() => assertPinnedFixtureClock("stress", "2026-08-03T09:30:00+05:30"))
      .toThrow(/after the fixture anchor 2026-08-03/u)
    expect(() => assertPinnedFixtureClock("stress", "2026-08-31T09:30:00+05:30"))
      .toThrow(/before 2026-08-31/u)
    expect(() => assertPinnedFixtureClock("stress", "2026-09-14T09:30:00+05:30"))
      .toThrow(/must land in 2026-08/u)
  })

  it("judges the day the academy will serve, not a UTC slice of the instant", () => {
    // 2026-08-04T02:00Z is still 2026-08-03 in UTC terms for anyone slicing the
    // ISO string, but +05:30 puts it at 07:30 on the 4th, which is the day the
    // register will show. Slicing instead of converting would reject this pin.
    expect(assertPinnedFixtureClock("stress", "2026-08-04T02:00:00.000Z")).toBe("2026-08-04")
    // And the mirror: 20:00Z on the 3rd is already the 4th in Kolkata, so a pin
    // that looks like the anchor by UTC is legitimately one day past it.
    expect(assertPinnedFixtureClock("stress", "2026-08-03T20:00:00.000Z")).toBe("2026-08-04")
  })
})

describe("advisory ceilings and the day they were counted on", () => {
  const pinnedRenderDay = "2026-08-17"
  // What the file holds today, written out rather than read, so this assertion
  // keeps its meaning after the re-record it is asking for.
  const countedBeforeThePin: AccessibilityAdvisoryBaseline = {
    clocks: { stress: null },
    profiles: { stress: { "color-contrast": 1021 } },
  }

  it("lets a run that renders on the recorded day be ratcheted normally", () => {
    const countedAtThePin: AccessibilityAdvisoryBaseline = {
      clocks: { stress: pinnedRenderDay },
      profiles: { stress: { "color-contrast": 1021 } },
    }
    expect(accessibilityAdvisoryClockMismatch("stress", pinnedRenderDay, countedAtThePin)).toBeNull()
    // And an unpinned profile, recorded unpinned, is not dragged into this.
    expect(accessibilityAdvisoryClockMismatch("admin", null, {
      clocks: { admin: null },
      profiles: { admin: { "color-contrast": 147 } },
    })).toBeNull()
  })

  it("refuses a ceiling counted on a different day, which the ratchet alone accepts", () => {
    // The whole point, in two lines. 1021 was counted on an unpinned run whose
    // reference date was 2026-08-26; the pin renders 2026-08-17, nine junior-coach
    // ledger cells earlier, so a pinned run lands well under it.
    const pinnedRun = [resultWithAdvisories("stress", [advisory("color-contrast")])]
    expect(accessibilityAdvisoryRegressions(pinnedRun, countedBeforeThePin)).toEqual([])
    // That silence is the defect: a ceiling nobody re-measured, with headroom the
    // pinned render will never use, and no drift left to force a re-record.
    expect(accessibilityAdvisoryClockMismatch("stress", pinnedRenderDay, countedBeforeThePin))
      .toEqual(expect.stringMatching(
        /counted against a render at the runner's own clock, but this run renders at 2026-08-17/u,
      ))
    expect(accessibilityAdvisoryClockMismatch("stress", pinnedRenderDay, countedBeforeThePin))
      .toEqual(expect.stringContaining("update-accessibility-advisory-baseline"))
  })

  it("moving the pin refuses just as loudly as introducing it", () => {
    const countedAtThePin: AccessibilityAdvisoryBaseline = {
      clocks: { stress: pinnedRenderDay },
      profiles: { stress: { "color-contrast": 967 } },
    }
    expect(accessibilityAdvisoryClockMismatch("stress", "2026-08-20", countedAtThePin))
      .toEqual(expect.stringMatching(
        /counted against a render at 2026-08-17, but this run renders at 2026-08-20/u,
      ))
  })

  it("leaves a never-recorded profile to the stronger complaint the ratchet already makes", () => {
    expect(accessibilityAdvisoryClockMismatch("stress", pinnedRenderDay, { profiles: { stress: null } }))
      .toBeNull()
    expect(accessibilityAdvisoryRegressions(
      [resultWithAdvisories("stress", [advisory("color-contrast")])],
      { profiles: { stress: null } },
    )).toEqual([expect.stringContaining("stress · advisory baseline never recorded")])
  })

  it("keeps the checked-in ceilings in force only on the day they were counted", () => {
    // Stated as an invariant rather than as today's answer, because today's
    // answer is "refused" and the re-record it demands will make it "in force".
    const workflow = readFileSync(path.resolve(".github/workflows/ui-accessibility.yml"), "utf8")
    const pin = assertPinnedFixtureClock("stress", workflow.match(
      /SMBA_ACCESSIBILITY_CLOCK:\s*"([^"]+)"/u,
    )?.[1])
    const { baseline, problem } = readAccessibilityAdvisoryBaseline()
    expect(problem).toBeNull()
    const inForce = accessibilityAdvisoryClockMismatch("stress", pin, baseline) === null
    expect(inForce).toBe((baseline.clocks?.stress ?? null) === pin)
  })

  it("carries a recorded day for every profile in the checked-in baseline", () => {
    // Absent would read as "counted unpinned", which is true today and will stop
    // being true for stress; writing it out keeps the file saying which it is.
    const { baseline, problem } = readAccessibilityAdvisoryBaseline()
    expect(problem).toBeNull()
    for (const profile of accessibilityProfiles) {
      expect(
        Object.hasOwn(baseline.clocks ?? {}, profile),
        `${profile} has no recorded fixture clock`,
      ).toBe(true)
    }
  })

  it("records the day beside the results, so a re-record cannot invent one", () => {
    const directory = mkdtempSync(path.join(realpathSync(os.tmpdir()), "smba-a11y-clock-file-"))
    temporaryDirectories.push(directory)
    // update-accessibility-advisory-baseline.ts records what the run wrote here,
    // never what the operator's shell happens to hold at recording time.
    writeAccessibilityResults(directory, [resultWithAdvisories("stress", [])], "2026-08-17")
    expect(readAccessibilityFixtureClock(directory)).toEqual({
      fixtureClock: "2026-08-17",
      problem: null,
    })
    writeAccessibilityResults(directory, [resultWithAdvisories("admin", [])], null)
    expect(readAccessibilityFixtureClock(directory)).toEqual({ fixtureClock: null, problem: null })
    expect(readAccessibilityFixtureClock(path.join(directory, "never-run")).problem)
      .toEqual(expect.stringContaining("ENOENT"))
  })
})

describe("the clock the server renders at, not the one this process holds", () => {
  it("accepts a server that reports the day the run was configured for", () => {
    expect(assertServerFixtureClock("2026-08-17", { fixtureClock: "2026-08-17", status: "ok" }, "/api/health"))
      .toBe("2026-08-17")
  })

  it("refuses a server that reports no pin, which is what a runner-only export produces", () => {
    // The failure this guard exists for: SMBA_ACCESSIBILITY_CLOCK prefixed onto
    // `npm run regression:accessibility` pins Playwright and nothing else, because
    // lib/clock.ts reads it in the Next process and the config starts no webServer.
    expect(() => assertServerFixtureClock("2026-08-17", { status: "ok" }, "/api/health"))
      .toThrow(/export it before `next start`/u)
    expect(() => assertServerFixtureClock("2026-08-17", { fixtureClock: null }, "/api/health"))
      .toThrow(/renders at its own wall clock/u)
    expect(() => assertServerFixtureClock("2026-08-17", "ok", "/api/health"))
      .toThrow(/reports no pinned clock/u)
  })

  it("refuses a server pinned to a different day than the runner was told", () => {
    expect(() => assertServerFixtureClock("2026-08-17", { fixtureClock: "2026-08-26" }, "/api/health"))
      .toThrow(/reports the server renders at 2026-08-26, but this run was configured for 2026-08-17/u)
  })
})

describe("the CI artifact the re-record is supposed to come from", () => {
  // upload-artifact resolves every `path:` line with @actions/glob. Only two
  // wildcards appear in this workflow -- `**` for any depth and `*` inside a
  // single segment -- and this translates both. `**` is read as one directory or
  // more rather than zero or more, which is stricter than the real matcher and
  // can therefore only make this test harder to pass, never easier.
  function matchesUploadPattern(pattern: string, relativePath: string) {
    const source = pattern
      .split("/")
      .map((segment) => (segment === "**"
        ? "[^/]+(?:/[^/]+)*"
        : segment.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replaceAll("*", "[^/]*")))
      .join("/")
    return new RegExp(`^${source}$`, "u").test(relativePath)
  }

  function uploadPatterns() {
    const workflow = readFileSync(path.resolve(".github/workflows/ui-accessibility.yml"), "utf8")
    const lines = (workflow.split("- name: Upload failure evidence").at(1) ?? "").split("\n")
    const start = lines.findIndex((line) => line.trim() === "path: |")
    const indent = lines[start].length - lines[start].trimStart().length
    const patterns: string[] = []
    for (const line of lines.slice(start + 1)) {
      if (!line.trim()) break
      if (line.length - line.trimStart().length <= indent) break
      patterns.push(line.trim())
    }
    return patterns
  }

  function filesUnder(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (
      entry.isDirectory()
        ? filesUnder(path.join(directory, entry.name))
        : [path.join(directory, entry.name)]
    ))
  }

  it("carries every file a recording reads, not only the counts", () => {
    // The state the stress step leaves behind when it fails on a clock mismatch:
    // the matrix ran to completion, so writeAccessibilityResults produced its
    // files, and "Show server logs after a failure" wrote a sanitized log
    // because a profile step failed.
    const workspace = mkdtempSync(path.join(realpathSync(os.tmpdir()), "smba-a11y-artifact-"))
    temporaryDirectories.push(workspace)
    const outputRoot = path.join(workspace, "output")
    writeAccessibilityResults(
      path.join(outputRoot, "accessibility", "stress"),
      [resultWithAdvisories("stress", [advisory("color-contrast")])],
      "2026-08-17",
    )
    const logDirectory = path.join(outputRoot, "failure-evidence", "accessibility")
    mkdirSync(logDirectory, { recursive: true })
    writeFileSync(path.join(logDirectory, "stress-server.sanitized.txt"), "ready\n")

    const patterns = uploadPatterns()
    const uploaded = filesUnder(outputRoot)
      .map((file) => path.relative(workspace, file))
      .filter((relative) => patterns.some((pattern) => matchesUploadPattern(pattern, relative)))

    // upload-artifact roots the archive at the deepest common ancestor of
    // everything it matched, which the sanitized server log puts at `output/`.
    const artifact = path.join(workspace, "extracted")
    for (const relative of uploaded) {
      const inside = path.relative("output", relative)
      mkdirSync(path.join(artifact, path.dirname(inside)), { recursive: true })
      copyFileSync(path.join(workspace, relative), path.join(artifact, inside))
    }

    // The read update-accessibility-advisory-baseline.ts makes before it records
    // a profile. Its `problem` is the "Refusing to record stress: ENOENT" an
    // operator gets from an artifact that left the clock file behind, and the
    // only remedy from there is a local fixture build, `npm run build` and a
    // Playwright run.
    expect(readAccessibilityFixtureClock(path.join(artifact, "accessibility", "stress")))
      .toEqual({ fixtureClock: "2026-08-17", problem: null })

    // Stated as an invariant as well, so it is not only the clock file that is
    // protected: adding a fourth sanitized file to writeAccessibilityResults
    // without adding it here fails rather than quietly shipping an artifact the
    // next recording cannot use.
    const produced = filesUnder(path.join(outputRoot, "accessibility"))
      .map((file) => path.relative(workspace, file))
    expect(produced.filter((relative) => !uploaded.includes(relative))).toEqual([])
  })
})
