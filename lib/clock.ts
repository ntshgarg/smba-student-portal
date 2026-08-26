import "server-only"

import {
  accessibilityGateProfiles,
  disposableAccessibilityDatabase,
  isAccessibilityGateProfile,
} from "@/lib/accessibility-gate"
import { getAcademyDateKey, getAcademyMonthKey } from "@/lib/format"

// The accessibility gate audits a fixture whose dates are frozen with an
// application that renders against the runner's clock, and the gap between the
// two widens by a day every day. `scripts/regression/fixture.ts:1135-1140` seeds
// the junior coach's ledger with 20 staff-attendance days ending at
// FIXTURE_ANCHOR_DATE (2026-08-03), and
// `components/coach/junior-coach-attendance-calendar.ts:52-57` calls a cell
// "unavailable" only while its date key sorts after the reference date -- so
// every midnight promotes one more August cell from "not available" to "not
// recorded" and hands axe a differently coloured grid. The clean measurement of
// that is the 1015 -> 1021 step in `stress · color-contrast`: it was recorded by
// 58460e6, which touched app/login/actions.ts, lib/auth/pin-plugin.ts and three
// test files and no CSS at all, one academy midnight after the 1015 recording --
// six advisories for one night. (The earlier 1013 -> 1015 step rode in on
// 8949df8, which did change eight CSS files including app/globals.css, so on its
// own it proves nothing about the clock; docs/PORTAL-AUDIT-7fac52d.md F-43
// records the same 1015 measured on three branches over one base commit, one of
// which changed no CSS, which is where that step's evidence actually lives.)
// Three re-records of a ceiling that is only supposed to move when the CSS moves.
//
// Reading the clock through here lets that one run render the frozen fixture at
// a frozen instant. Every other process reaches `new Date()` on the first line
// and behaves exactly as before, because the pin is opt-in through an
// environment variable no deployment sets.
//
// What it does not reach, stated so nobody reads the pin as more than it is:
// this module is server-only, so a component that takes its own "now" at mount
// is outside it. Three registers were brought inside by having their pages pass
// academyNow() down and their 30s tick advance from it. The rest still read the
// device: components/coach/attendance-adjustments-workspace.tsx:145, :163 and
// :164 are the ones that matter, because :163 gates
// `occurrence.occurrenceDate <= todayKey` in sourceOptions and the audited
// `coach-attendance-adjustments` state therefore still grows an option every
// midnight. Behind them, session-schedules.tsx:138, session-create.tsx:88,
// financials-rapid-desk.tsx:76 and :287, refund-form.tsx:38, :39, :224 and :245,
// fee-plan-editor.tsx:29, report-workspace.tsx:552, and
// announcement-presentation.ts:19 -- that last one shared with client trees, so
// it cannot import this module at all without breaking them. The pin removes
// most of the drift, not all of it.
function pinnedAccessibilityInstant() {
  const configured = process.env.SMBA_ACCESSIBILITY_CLOCK?.trim()
  if (!configured) return null

  // Past this point the variable is set, so every rejection throws rather than
  // falling back. A silent fallback has two bad outcomes and no good one: in the
  // gate it resumes the drift this module exists to remove, without anyone
  // noticing until the ceiling moves again; in a deployment it would serve
  // coaches a frozen "today" on the attendance register, which is the one
  // screen this product cannot get wrong. Refusing to render is louder and
  // safer than either.
  //
  // The conditions below are `lib/auth/mailer.ts`'s, imported rather than
  // copied. The response is deliberately the opposite of that file's:
  // memoryAuthMailerAllowed() returns false and falls back to the real
  // transport, because a misconfigured mailer that still sends real email is
  // recoverable, whereas a misconfigured clock that quietly reads the wall clock
  // is indistinguishable from a correct one until a ceiling moves weeks later.
  // mailer.ts also applies its checks only under NODE_ENV=production; these
  // apply always, so a developer who points SMBA_ACCESSIBILITY_CLOCK at
  // `.data/academy-stress.db` gets the message below on the first render rather
  // than a dev server that lies about today for the rest of the afternoon.
  if (process.env.VERCEL) {
    throw new Error("SMBA_ACCESSIBILITY_CLOCK must never be set on a Vercel deployment.")
  }
  if (!isAccessibilityGateProfile(process.env.SMBA_ACCESSIBILITY_PROFILE)) {
    throw new Error(
      "SMBA_ACCESSIBILITY_CLOCK requires SMBA_ACCESSIBILITY_PROFILE to name an"
      + ` accessibility gate profile (${accessibilityGateProfiles.join(", ")}).`,
    )
  }
  if (!disposableAccessibilityDatabase()) {
    throw new Error(
      "SMBA_ACCESSIBILITY_CLOCK requires DB_FILE_NAME to be a disposable"
      + " accessibility database under the operating system temporary root.",
    )
  }
  const instant = Date.parse(configured)
  if (Number.isNaN(instant)) {
    throw new Error(`SMBA_ACCESSIBILITY_CLOCK is not a parsable instant: ${configured}`)
  }
  return instant
}

/**
 * The instant a server render should treat as now. Callers receive a fresh Date
 * every time because several of them advance it with setUTCDate.
 */
export function academyNow() {
  const pinned = pinnedAccessibilityInstant()
  return pinned === null ? new Date() : new Date(pinned)
}

/** The academy-local date key a server render should treat as today. */
export function academyToday() {
  return getAcademyDateKey(academyNow())
}

/** The academy-local month key a server render should treat as the current one. */
export function academyCurrentMonth() {
  return getAcademyMonthKey(academyNow())
}

/**
 * The academy date this *server process* is pinned to, or null when nothing is
 * pinned. `app/api/health/route.ts` echoes it and
 * `tests/e2e/accessibility-regression.spec.ts` reads it back before it audits
 * anything, because SMBA_ACCESSIBILITY_CLOCK is read here -- in the Next process
 * -- and `tests/e2e/playwright.accessibility.config.ts` starts no `webServer`.
 * A run that exported the variable to the Playwright runner alone would satisfy
 * every runner-side guard and still audit a wall-clock server.
 */
export function pinnedAccessibilityDateKey() {
  const pinned = pinnedAccessibilityInstant()
  return pinned === null ? null : getAcademyDateKey(new Date(pinned))
}
