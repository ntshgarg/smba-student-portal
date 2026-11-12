import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

function between(text: string, start: string, end: string) {
  const from = text.indexOf(start)
  expect(from).toBeGreaterThanOrEqual(0)
  const to = text.indexOf(end, from + start.length)
  expect(to).toBeGreaterThan(from)
  return text.slice(from, to)
}

// Refusals refetching, the panel staying open while saving and the return to
// onboarding are run for real in tests/holiday-calendar-render.test.tsx and
// tests/holiday-screen-handlers.test.ts. What is left here is wiring that only
// shows in a browser or behind a signed-in server action.
describe("the coach calendar stays in step with the server", () => {
  const provider = source("components/coach/coach-portal-provider.tsx")

  it("takes the holiday list from every server refresh, like the sessions", () => {
    const reconcile = between(provider, "const timer = window.setTimeout(() => {", "return () => window.clearTimeout(timer)")
    expect(reconcile).toContain("setAcademyHolidays(initialAcademyHolidays)")
    expect(reconcile).toContain("setSessionOccurrences(initialSessionOccurrences)")
  })
})

describe("closing days from a month that does not hold them", () => {
  it("asks for, and gets back, the month on screen", () => {
    const composer = source("components/coach/calendar/holiday-composer.tsx")
    expect(composer).toContain("markAcademyHolidays({ dateKeys: dates, label, viewMonth })")

    const actions = source("app/coach/actions.ts")
    const mark = between(actions, "export async function markAcademyHolidaysAction", "export async function retractAcademyHolidayAction")
    expect(mark).toContain("getCoachCalendarMonthSessionSnapshot(viewMonth)")
    expect(mark).not.toContain("getCoachCalendarMonthSessionSnapshot(anchorDate")
  })
})
