import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

// The portal rules these assertions pin live in app/portal.css since the F-22
// split; app/globals.css keeps only what the marketing homepage and the root
// error boundaries can reach. Both stylesheets load on every authenticated
// route, globals first, so concatenating them in that order is what the browser
// actually resolves and keeps the assertions indifferent to which side a rule
// sits on.
function portalStyles() {
  return source("app/globals.css") + source("app/portal.css")
}

describe("authentication error focus", () => {
  it("returns focus after every failed login response", () => {
    const login = source("components/login-form.tsx")

    expect(login).toContain("const academyIdRef = useRef<HTMLInputElement>(null)")
    expect(login).toContain("ref={academyIdRef}")
    expect(login).toContain("window.setTimeout(() => academyIdRef.current?.focus(), 0)")
    expect(login).toContain("submissionStartedRef.current = true")
    expect(login).toMatch(/useEffect\(\(\) => \{[\s\S]*?\}, \[pending, state\]\)/)
    expect(login).not.toContain("[state.error]")
  })

  it("returns focus and associates registration errors with the name field", () => {
    const registration = source("components/registration-form.tsx")

    expect(registration).toContain("const fullNameRef = useRef<HTMLInputElement>(null)")
    expect(registration).toContain("ref={fullNameRef}")
    expect(registration).toMatch(/if \(state\.error && state\.errorField === "fullName"\) fullNameRef\.current\?\.focus\(\)/)
    expect(registration).toContain('aria-describedby={fullNameError ? "full-name-error" : undefined}')
    expect(registration).toContain('aria-invalid={fullNameError ? true : undefined}')
    expect(registration).toContain('id="full-name-error"')
    expect(registration).toContain('id="registration-form-error"')
    expect(registration).toContain("value={fullName}")
    expect(registration).toContain('method="post"')
    expect(registration).toContain("submitButtonRef.current?.focus()")
  })
})

describe("courtside save focus", () => {
  // The save button is the element the coach's own press would disable, and a
  // disabled element hands focus to `<body>`, so the next Tab would restart at
  // the skip link. Both registers keep it focusable and re-check the condition
  // in the handler instead, which is what leaves the retry one keystroke away.
  // The roster's own choice buttons go the same way, because Safari and Firefox
  // do not move focus to a button on click and so leave the coach standing
  // there while the save disables the roster.
  const footerButton = (contents: string) => contents
    .slice(contents.indexOf('className="attendance-record-footer"'))
    .match(/<button[\s\S]*?<\/button>/u)?.[0] ?? ""
  const styles = portalStyles()

  it("keeps the player register's save button focusable across a save", () => {
    const recorder = source("components/coach/attendance/player-attendance-recorder.tsx")
    const button = footerButton(recorder)

    expect(recorder).toContain(
      "const cannotSave = !draftChanges.length || isSaving || selectedUnavailable",
    )
    expect(recorder).toContain("if (cannotSave || !selectedOccurrence) return")
    expect(button).not.toMatch(/\sdisabled=/u)
    expect(button).toContain("aria-busy={isSaving}")
    expect(button).toContain("aria-disabled={cannotSave}")
    expect(button).toContain('feedback?.offerRetry ? "Save attendance again"')
    // Out of the tab order whenever no press could ever help, so the always-
    // rendered footer is not a silent no-op on a cancelled or unmarked session.
    expect(recorder).toContain("const saveOutOfReach = cannotSave && !isSaving")
    expect(button).toContain("tabIndex={saveOutOfReach ? -1 : undefined}")
    expect(recorder).toContain("aria-disabled={isSaving}")
    expect(recorder).not.toMatch(/\sdisabled=\{isSaving\}/u)
    expect(styles).toContain(
      '.player-attendance-recorder .attendance-record-footer > button[aria-disabled="true"]',
    )
    expect(styles).toContain(
      '.player-attendance-recorder .attendance-roster-choices button[aria-disabled="true"]',
    )
    // `opacity` composites the outline, so the dim would take the focus ring
    // under 1.4.11's 3:1 with it on the states this now makes reachable.
    expect(styles).toContain(
      '.player-attendance-recorder .attendance-record-footer > button[aria-disabled="true"]:focus-visible',
    )
    expect(styles).toContain(
      '.player-attendance-recorder .attendance-roster-choices button[aria-disabled="true"]:focus-visible',
    )
  })

  it("keeps the staff roll call's save button focusable across a save", () => {
    const rollCall = source("components/coach/attendance/staff-roll-call.tsx")
    const button = footerButton(rollCall)

    expect(rollCall).toContain("const cannotSave = !drafts.length || isSaving || futureDate")
    expect(rollCall).toContain("if (cannotSave) return")
    expect(button).not.toMatch(/\sdisabled=/u)
    expect(button).toContain("aria-busy={isSaving}")
    expect(button).toContain("aria-disabled={cannotSave}")
    expect(button).toContain('feedback?.offerRetry ? "Save staff attendance again"')
    expect(rollCall).toContain("const saveOutOfReach = cannotSave && !isSaving")
    expect(button).toContain("tabIndex={saveOutOfReach ? -1 : undefined}")
    // `unavailable` is a property of the date, so it keeps `disabled` and stays
    // out of the tab order; only the in-flight save moves to `aria-disabled`.
    expect(rollCall).toContain("disabled={unavailable}")
    expect(rollCall).toContain("aria-disabled={unavailable || isSaving}")
    expect(rollCall).not.toMatch(/\sdisabled=\{unavailable \|\| isSaving\}/u)
    expect(styles).toContain(
      '.attendance-record-footer > button[aria-disabled="true"]',
    )
    expect(styles).toContain(
      '> .staff-roll-call-choice-box button[aria-disabled="true"]',
    )
    expect(styles).toContain(
      '.attendance-record-footer > button[aria-disabled="true"]:focus-visible',
    )
    expect(styles).toContain(
      '> .staff-roll-call-choice-box button[aria-disabled="true"]:focus-visible',
    )
  })
})

describe("operational mobile controls", () => {
  const styles = portalStyles()
  const mediaStart = styles.indexOf('@media (max-width: 720px), (pointer: coarse) {')
  // The reduced-motion floor used to open right after this query and marked its
  // end; the F-22 split held that floor back in globals.css, so bound the slice
  // on the query's own unindented closing brace instead.
  const mediaEnd = styles.indexOf("\n}\n", mediaStart)
  const antiZoomRule = styles.slice(mediaStart, mediaEnd)

  it("uses 16px text for only the scoped visible inputs and selects", () => {
    expect(mediaStart).toBeGreaterThan(-1)
    // The courtside date input only reached 16px under (max-width: 760px), so an
    // iPad or a phone in landscape still zoomed the roll call on focus (F-13).
    expect(antiZoomRule).toContain(".attendance-record-date-row input:not(")
    expect(antiZoomRule).toContain(".coach-series-form input:not(")
    expect(antiZoomRule).toContain(".coach-roster-assign input:not(")
    expect(antiZoomRule).toContain(".coach-registration-approved p input:not(")
    expect(antiZoomRule).toContain(".coach-member-search input:not(")
    expect(antiZoomRule).toContain(".coach-member-filter select")
    expect(antiZoomRule).toContain(".coach-member-form-grid input:not(")
    expect(antiZoomRule).toContain(".coach-adjustment-field select")
    expect(antiZoomRule).not.toContain(".coach-adjustment-missed-calendar-toolbar select")
    expect(antiZoomRule).toContain(".coach-adjustment-reason input:not(")
    expect(antiZoomRule).toContain(".coach-calendar-controls input:not(")
    expect(antiZoomRule).toContain(".coach-occurrence-actions input:not(")
    expect(antiZoomRule).toContain(':not([type="checkbox"]):not([type="radio"]):not([type="hidden"])')
    expect(antiZoomRule).toContain("font-size: 16px")
    expect(antiZoomRule).not.toContain(".coach-member-batch-field input")
  })

  it("gives register jump controls a real 44px target without changing their visual treatment", () => {
    const registerButtonRule = styles.match(/\.coach-register-period button \{([^}]*)\}/)?.[1]

    expect(registerButtonRule).toContain("display: inline-flex")
    expect(registerButtonRule).toContain("min-height: 44px")
    expect(registerButtonRule).toContain("align-items: center")
    expect(registerButtonRule).toContain("padding: 0")
    expect(registerButtonRule).toContain("border: 0")
    expect(registerButtonRule).toContain("background: transparent")
  })
})
