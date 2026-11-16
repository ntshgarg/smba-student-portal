import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("attendance return navigation", () => {
  it.each([
    ["app/coach/attendance/players/register/page.tsx", "register"],
    ["app/coach/attendance/staff/register/page.tsx", "register"],
    ["app/coach/attendance/adjustments/page.tsx", "makeups"],
  ])("puts %s under the Attendance shell, whose back link returns to the dashboard section", (relativePath, tab) => {
    expect(source(relativePath)).toContain(`<AttendanceShell activeTab="${tab}">`)
    expect(source("components/coach/attendance/attendance-shell.tsx"))
      .toContain('backHref = "/coach#attendance"')
  })

  // The Mark tab's back link is the Attendance shell's; the page only swaps it
  // for the calendar's when the calendar opened it.
  it("keeps the Mark tab contextual only when opened from Calendar", () => {
    const shell = source("components/coach/attendance/attendance-shell.tsx")
    const page = source("app/coach/attendance/players/record/page.tsx")

    expect(shell).toContain('backHref = "/coach#attendance"')
    expect(page).toContain("backHref={selection.fromCalendar")
    expect(page).toContain("`/coach/calendar?date=${encodeURIComponent(selection.dateKey)}`")
    expect(page).toContain('backLabel={selection.fromCalendar ? "Back to calendar" : undefined}')
  })
})
