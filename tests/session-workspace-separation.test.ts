import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("session workspace ownership", () => {
  it("keeps Calendar observational and delegates attendance recording", () => {
    const calendar = source("components/coach/calendar/session-calendar.tsx")

    expect(calendar).not.toContain("saveAttendanceRegister")
    expect(calendar).not.toContain("cycleAttendance")
    expect(calendar).toContain("Open attendance")
    expect(calendar).toContain("/coach/attendance/players/record?date=")
  })

  it("separates recurring-schedule creation from roster management", () => {
    const create = source("components/coach/calendar/session-create.tsx")
    const rosters = source("components/coach/calendar/session-schedules.tsx")
    const card = source("components/coach/sessions-card.tsx")

    expect(create).toContain("createSessionSeries")
    expect(rosters).not.toContain("createSessionSeries")
    expect(card).toContain('href="/coach/calendar"')
    expect(card).toContain('href="/coach/schedules/new"')
    expect(card).toContain('href="/coach/schedules"')
  })
})
