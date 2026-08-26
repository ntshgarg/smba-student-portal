import { existsSync, realpathSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { getAcademyDateKey } from "../../../lib/format"
import { FIXTURE_ANCHOR_DATE } from "../../../scripts/regression/profiles"

export function assertDisposableAccessibilityDatabase(databasePath: string | undefined) {
  if (!databasePath) {
    throw new Error("SMBA_ACCESSIBILITY_DB is required.")
  }
  if (!path.isAbsolute(databasePath)) {
    throw new Error("SMBA_ACCESSIBILITY_DB must be an absolute path.")
  }
  if (!existsSync(databasePath)) {
    throw new Error(`SMBA_ACCESSIBILITY_DB does not exist: ${databasePath}`)
  }
  const realDatabasePath = realpathSync(databasePath)
  const temporaryRoots = new Set([
    realpathSync(os.tmpdir()),
    realpathSync("/tmp"),
  ])
  const isDisposablePath = [...temporaryRoots].some((temporaryRoot) => {
    const relative = path.relative(temporaryRoot, realDatabasePath)
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  })
  if (!isDisposablePath) {
    throw new Error("SMBA_ACCESSIBILITY_DB must be a disposable database under the system temporary directory.")
  }
  if (!/smba[-_.].*accessibility|smba-accessibility|smba-a11y/u.test(path.basename(realDatabasePath))) {
    throw new Error("SMBA_ACCESSIBILITY_DB must have an accessibility-specific filename.")
  }
  return realDatabasePath
}

// Only the stress profile carries a fixture whose rows are all derived from
// FIXTURE_ANCHOR_DATE; the admin and clean databases are seeded from the
// runner's own clock and are already self-consistent. Rendering a frozen fixture
// against a moving clock is what walked `stress · color-contrast` to 1021: the
// 1015 -> 1021 step landed in 58460e6, which touched app/login/actions.ts,
// lib/auth/pin-plugin.ts and three test files and no CSS at all, one academy
// midnight after the 1015 recording. `components/coach/junior-coach-attendance-calendar.ts:52-57`
// calls a cell "not available" only while its date key sorts after the reference
// date, so every midnight promotes one more August cell into a differently
// coloured state. SMBA_ACCESSIBILITY_CLOCK supplies the instant that stops it
// (`lib/clock.ts`), and refusing to audit without it is the point: an unpinned
// run records a ceiling nobody can reproduce tomorrow, and re-recording that
// ceiling is what has already happened three times.
//
// The bounds keep the pin honest in the other direction, because a pin that
// dropped a rendered state would buy stability by auditing less. The instant has
// to land in the month the matrix asks for by hand (`?year=2026&month=08`,
// `?period=2026-08`), strictly after the anchor or the ledger holds no "not
// recorded" day, and strictly before the month ends or it holds no "not
// available" one. Moving FIXTURE_ANCHOR_DATE therefore fails this until the
// workflow's instant moves with it, which is the coupling profiles.ts documents.
export function assertPinnedFixtureClock(profile: string, configured: string | undefined) {
  const value = configured?.trim()
  // Refused rather than ignored, because ignoring it here is not the same as
  // nothing happening. `lib/clock.ts` pins admin and clean just as willingly --
  // both names pass isAccessibilityGateProfile, and /tmp/smba-accessibility-admin.db
  // passes disposableAccessibilityDatabase -- so a variable still exported from
  // an earlier stress run in the same shell freezes those servers too, while
  // this runner returns null and writes `fixtureClock: null` beside the results.
  // Null is exactly what the baseline records for these profiles, so the clock
  // comparison would match and the run would pass having compared counts from a
  // pinned DOM against counts from an unpinned one. That is the failure this
  // whole guard exists to close, arriving through the door the docs recipe opens
  // by teaching `export SMBA_ACCESSIBILITY_CLOCK=...`.
  if (profile !== "stress") {
    if (value) {
      throw new Error(
        `SMBA_ACCESSIBILITY_CLOCK must not be set for the ${profile} profile, whose fixture is`
        + " seeded from the clock it is rendered against and needs no pin. lib/clock.ts pins the"
        + " server anyway when it is set, so this run would audit a frozen DOM and record it as"
        + " unpinned. Unset it — it belongs only to the stress step.",
      )
    }
    return null
  }
  if (!value) {
    throw new Error(
      "SMBA_ACCESSIBILITY_CLOCK is required for the stress profile, whose fixture is frozen at"
      + ` ${FIXTURE_ANCHOR_DATE}. Without it the audited DOM changes every midnight.`,
    )
  }
  const instant = Date.parse(value)
  if (Number.isNaN(instant)) {
    throw new Error(`SMBA_ACCESSIBILITY_CLOCK is not a parsable instant: ${value}`)
  }
  // Read through the same helper `lib/clock.ts` renders with, so the day this
  // judges is the day the server will actually serve rather than a UTC slice of
  // it — the two disagree for any instant inside the academy's +05:30 offset.
  const dateKey = getAcademyDateKey(new Date(instant))
  const anchorMonth = FIXTURE_ANCHOR_DATE.slice(0, 7)
  const [anchorYear, anchorMonthNumber] = anchorMonth.split("-").map(Number)
  // Day 0 of the following month is the last day of this one, read at midday so
  // the +05:30 conversion cannot walk it into a neighbouring date.
  const lastDayOfMonth = getAcademyDateKey(new Date(Date.UTC(anchorYear, anchorMonthNumber, 0, 12)))
  if (!dateKey.startsWith(anchorMonth)) {
    throw new Error(
      `SMBA_ACCESSIBILITY_CLOCK must land in ${anchorMonth}, the month the accessibility matrix`
      + ` requests by hand, but ${value} renders as ${dateKey}.`,
    )
  }
  if (dateKey <= FIXTURE_ANCHOR_DATE) {
    throw new Error(
      `SMBA_ACCESSIBILITY_CLOCK must fall after the fixture anchor ${FIXTURE_ANCHOR_DATE}, or the`
      + ` audited ledger holds no "not recorded" day, but ${value} renders as ${dateKey}.`,
    )
  }
  if (dateKey >= lastDayOfMonth) {
    throw new Error(
      `SMBA_ACCESSIBILITY_CLOCK must fall before ${lastDayOfMonth}, or the audited ledger holds no`
      + ` "not available" day, but ${value} renders as ${dateKey}.`,
    )
  }
  return dateKey
}

// assertPinnedFixtureClock above judges this process. It cannot judge the one
// that matters: `lib/clock.ts` reads SMBA_ACCESSIBILITY_CLOCK in the Next server,
// and `tests/e2e/playwright.accessibility.config.ts` declares no `webServer`, so
// Playwright attaches to a server somebody else started. Exporting the variable
// to the runner alone therefore satisfies every runner-side check while the
// server keeps rendering at wall clock -- a green run that is exactly as drifty
// as an unpinned one, plus a false assurance. In CI it happens to work only
// because one step's `env:` block covers both `next start` and the runner, which
// is coupling by accident.
//
// So ask the server. `app/api/health/route.ts` echoes the academy date it is
// pinned to, and only while it is pinned, so an absent field is proof of a
// wall-clock server rather than an old build.
export function assertServerFixtureClock(
  expected: string,
  payload: unknown,
  healthUrl: string,
) {
  const reported = payload && typeof payload === "object"
    ? (payload as { fixtureClock?: unknown }).fixtureClock
    : undefined
  if (reported === undefined || reported === null) {
    throw new Error(
      `${healthUrl} reports no pinned clock, so the server behind it renders at its own wall clock`
      + ` while this run expects ${expected}. SMBA_ACCESSIBILITY_CLOCK is read by the Next process`
      + " (lib/clock.ts), not by Playwright: export it before `next start`, not only before"
      + " `npm run regression:accessibility`.",
    )
  }
  if (reported !== expected) {
    throw new Error(
      `${healthUrl} reports the server renders at ${String(reported)}, but this run was configured`
      + ` for ${expected}. The runner and the server are reading different values of`
      + " SMBA_ACCESSIBILITY_CLOCK.",
    )
  }
  return expected
}
