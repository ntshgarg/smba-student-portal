import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("attendance return navigation", () => {
  it.each([
    "components/coach/attendance/staff-roll-call.tsx",
    "app/coach/attendance/adjustments/page.tsx",
  ])("returns %s to the Attendance dashboard section", (relativePath) => {
    const component = source(relativePath)

    expect(component).toContain('href="/coach#attendance"')
    expect(component).toContain("Back to Attendance")
    expect(component).not.toContain("Back to dashboard")
  })

  it.each([
    "app/coach/attendance/players/register/page.tsx",
    "app/coach/attendance/staff/register/page.tsx",
  ])("puts %s under the Attendance shell, whose back link returns to the dashboard section", (relativePath) => {
    expect(source(relativePath)).toContain('<AttendanceShell activeTab="register">')
    expect(source("components/coach/attendance/attendance-shell.tsx"))
      .toContain('backHref = "/coach#attendance"')
  })

  it("keeps the player recorder contextual only when opened from Calendar", () => {
    const recorder = source("components/coach/attendance/player-attendance-recorder.tsx")

    expect(recorder).toContain(': "/coach#attendance"')
    expect(recorder).toContain('initialFromCalendar ? "Back to calendar" : "Back to Attendance"')
    expect(recorder).toContain("`/coach/calendar?date=${encodeURIComponent(selectedDate)}`")
    expect(recorder).not.toContain('"Back to dashboard"')
  })
})
