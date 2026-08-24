import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
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

describe("operational mobile controls", () => {
  const styles = source("app/globals.css")
  const mediaStart = styles.indexOf('@media (max-width: 720px), (pointer: coarse) {')
  const mediaEnd = styles.indexOf("@media (prefers-reduced-motion: reduce)", mediaStart)
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
