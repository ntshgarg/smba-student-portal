import { readFileSync } from "node:fs"
import path from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { WeekStrip } from "@/components/coach/attendance/week-strip"
import type { TrainingSessionOccurrence } from "@/lib/sessions/types"
import { occurrenceHasEnded } from "@/lib/sessions/occurrence-time"

vi.mock("next/navigation", () => ({
  usePathname: () => "/coach/calendar",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/app/coach/actions", () => ({}))
vi.mock("@/app/coach/attendance/adjustments/actions", () => ({}))

const { occurrenceTag } = await import("@/components/coach/calendar/session-calendar")
const { scheduleDates, shortDate } = await import("@/components/coach/calendar/session-schedules")

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

// 6:00–7:00 am IST on 16 Nov 2026.
const occurrence = {
  durationMinutes: 60,
  occurrenceDate: "2026-11-16",
  startsAt: "2026-11-16T00:30:00.000Z",
} as TrainingSessionOccurrence
const at = (iso: string) => new Date(iso).getTime()

describe("Sessions audit fixes", () => {
  it("calls a running session In progress, and Done only once it is over", () => {
    expect(occurrenceTag(occurrence, null, "2026-11-16", at("2026-11-16T00:00:00.000Z")).label).toBe("Later today")
    expect(occurrenceTag(occurrence, null, "2026-11-16", at("2026-11-16T00:50:00.000Z")).label).toBe("In progress")
    expect(occurrenceHasEnded(occurrence, at("2026-11-16T01:29:59.000Z"))).toBe(false)
    expect(occurrenceTag(occurrence, null, "2026-11-16", at("2026-11-16T01:30:00.000Z"))).toEqual({ label: "Done", tone: "done" })
  })

  it("dates a schedule without a year this season, and with one outside it", () => {
    expect(shortDate("2026-07-01", "2026-11-16")).toBe("1 Jul")
    expect(shortDate("2027-03-31", "2026-11-16")).toBe("31 Mar")
    expect(scheduleDates({ startsOn: "2024-07-01", endsOn: "2025-03-31" }, "2026-11-16")).toBe("1 Jul 2024 – 31 Mar 2025")
    expect(scheduleDates({ startsOn: "2024-07-01", endsOn: null }, "2026-11-16")).toBe("from 1 Jul 2024")
  })

  it("marks today in the week strip apart from the chosen day, with a Today button", () => {
    const html = renderToStaticMarkup(
      <WeekStrip onChoose={() => {}} onPick={() => {}} selectedDate="2026-11-18" today="2026-11-16" />,
    )
    expect(html).toContain("16 November 2026, today")
    expect(html).toMatch(/aria-current="date"[^>]*aria-label="Wednesday, 18 November 2026"/)
    expect(html).toContain(">Today</button>")
    expect(html).not.toContain("aria-expanded")
    // The Mark tab passes no today: its strip is unchanged.
    expect(renderToStaticMarkup(<WeekStrip onChoose={() => {}} selectedDate="2026-11-18" />)).not.toContain(">Today</button>")
  })

  it("lets each row's visible words name it, and keeps the focus returns", () => {
    const calendar = source("components/coach/calendar/session-calendar.tsx")
    const schedules = source("components/coach/calendar/session-schedules.tsx")
    expect(calendar).not.toMatch(/aria-label=\{`\$\{fullSessionLabel/)
    expect(schedules).not.toMatch(/aria-label=\{`\$\{seriesLabel\(series\)\}\./)
    // The holiday panel returns focus to Mark holiday, or to the notice after a save.
    expect(calendar).toContain('holidayFocusAfterClose.current = "notice"')
    expect(calendar).toContain("markHolidayRef.current")
    // The month closes on Esc or its own button, back to Pick a date.
    expect(calendar).toContain('aria-label="Close the month"')
    expect(calendar).toContain('event.key !== "Escape"')
  })

  it("asks about fees for the players coming off the schedule", () => {
    expect(source("components/coach/calendar/end-schedule-panel.tsx")).toContain("coming off this schedule")
  })
})
