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

describe("the coach calendar stays in step with the server", () => {
  const provider = source("components/coach/coach-portal-provider.tsx")

  it("takes the holiday list from every server refresh, like the sessions", () => {
    const reconcile = between(provider, "const timer = window.setTimeout(() => {", "return () => window.clearTimeout(timer)")
    expect(reconcile).toContain("setAcademyHolidays(initialAcademyHolidays)")
    expect(reconcile).toContain("setSessionOccurrences(initialSessionOccurrences)")
  })

  it("refetches after a session or holiday action is turned down", () => {
    for (const name of ["const cancelOccurrence", "const replaceOccurrence", "const retractHoliday"]) {
      const body = between(provider, name, "}, [")
      expect(body).toContain("refreshAfterRefusal(result)")
    }
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

  it("keeps the panel open while the closure is being saved", () => {
    const composer = source("components/coach/calendar/holiday-composer.tsx")
    const dismiss = between(composer, "function dismiss()", "}")
    expect(dismiss).toContain("if (busy) return")
    expect(composer).not.toMatch(/onCancel=\{\(event\) => \{\s*event\.preventDefault\(\)\s*onClose\(\)/u)
    expect(composer).not.toMatch(/if \(event\.target === event\.currentTarget\) onClose\(\)/u)
  })
})

describe("creating a schedule from a player's onboarding", () => {
  it("returns to onboarding through the unsaved-work guard, so the return is not undone", () => {
    const create = source("components/coach/calendar/session-create.tsx")
    const success = between(create, "if (guidedPlayer) {", "} catch (error)")
    expect(success).toMatch(/navigateAfterCommit\(\(\) => \{\s*router\.push\(`\/coach\/onboarding/u)
    expect(create).not.toContain("Manage roster")
  })
})
