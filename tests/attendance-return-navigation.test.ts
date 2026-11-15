import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("attendance return navigation", () => {
  it.each([
    "components/coach/player-attendance-register.tsx",
    "components/coach/staff-attendance-register.tsx",
    "app/coach/attendance/adjustments/page.tsx",
  ])("returns %s to the Attendance dashboard section", (relativePath) => {
    const component = source(relativePath)

    expect(component).toContain('href="/coach#attendance"')
    expect(component).toContain("Back to Attendance")
    expect(component).not.toContain("Back to dashboard")
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
