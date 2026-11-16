import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AcademyHolidayRecord } from "@/lib/sessions/holiday-types"
import type { TrainingSessionOccurrence, TrainingSessionSeries } from "@/lib/sessions/types"

const portal = vi.hoisted(() => ({
  actions: {
    cancelSessionOccurrenceAction: vi.fn(),
    publishAttendanceAdjustmentAction: vi.fn(),
    replaceSessionOccurrenceAction: vi.fn(),
    retractAcademyHolidayAction: vi.fn(),
  },
  /** Set to stand in for the provider; null lets the real one answer. */
  fake: null as null | Record<string, unknown>,
  refresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/coach/calendar",
  useRouter: () => ({ push: vi.fn(), refresh: portal.refresh, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => ({
    confirmDiscard: () => true,
    confirmNavigation: () => true,
    navigateAfterCommit: (navigate: () => void) => navigate(),
  }),
}))
vi.mock("@/app/coach/actions", () => ({
  archiveMemberAction: vi.fn(),
  cancelSessionOccurrenceAction: portal.actions.cancelSessionOccurrenceAction,
  createSessionSeriesAction: vi.fn(),
  endSessionSeriesAction: vi.fn(),
  markAcademyHolidaysAction: vi.fn(),
  previewAcademyHolidaysAction: vi.fn(),
  previewEndSessionSeriesAction: vi.fn(),
  replaceSessionOccurrenceAction: portal.actions.replaceSessionOccurrenceAction,
  retractAcademyHolidayAction: portal.actions.retractAcademyHolidayAction,
  saveAttendanceRegisterAction: vi.fn(),
  saveMemberAction: vi.fn(),
}))
vi.mock("@/app/coach/attendance/adjustments/actions", () => ({
  keepAttendanceAdjustmentAction: vi.fn(),
  publishAttendanceAdjustmentAction: portal.actions.publishAttendanceAdjustmentAction,
  voidAttendanceAdjustmentAction: vi.fn(),
}))
vi.mock("@/components/coach/coach-portal-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/coach/coach-portal-provider")>()
  return {
    ...actual,
    useMemberPortal: () => portal.fake ?? actual.useMemberPortal(),
    useSessionPortal: () => portal.fake ?? actual.useSessionPortal(),
  }
})

const { MonthGrid, SessionCalendar } = await import("@/components/coach/calendar/session-calendar")
const { CoachPortalProvider, useAttendancePortal, useSessionPortal } = await import("@/components/coach/coach-portal-provider")

afterEach(() => {
  portal.fake = null
  portal.refresh.mockReset()
  portal.actions.cancelSessionOccurrenceAction.mockReset()
  portal.actions.publishAttendanceAdjustmentAction.mockReset()
  portal.actions.replaceSessionOccurrenceAction.mockReset()
  portal.actions.retractAcademyHolidayAction.mockReset()
})

const series: TrainingSessionSeries = {
  batch: "Weekday",
  endsOn: "2027-03-31",
  id: "series-1",
  programme: "Beginner",
  slots: [{ durationMinutes: 60, id: "slot-1", startTime: "06:00", weekday: 0 }],
  startsOn: "2026-07-01",
  status: "active",
  title: "Beginner Weekday",
  venue: "SMBA Court",
}

function occurrence(dateKey: string, status: "scheduled" | "cancelled", holidayId: string | null = null): TrainingSessionOccurrence {
  return {
    durationMinutes: 60,
    eligibilityDate: dateKey,
    holidayId,
    id: `occurrence-${dateKey}-${status}`,
    occurrenceDate: dateKey,
    replacementForOccurrenceId: null,
    seriesId: series.id,
    startsAt: `${dateKey}T00:30:00.000Z`,
    status,
    venue: "SMBA Court",
  }
}

function renderCalendar({
  academyHolidays,
  sessionOccurrences,
}: {
  academyHolidays: AcademyHolidayRecord[]
  sessionOccurrences: TrainingSessionOccurrence[]
}) {
  portal.fake = {
    academyHolidays,
    cancelSessionOccurrence: vi.fn(),
    players: [],
    replaceSessionOccurrence: vi.fn(),
    retractAcademyHoliday: vi.fn(),
    sessionAssignments: [],
    sessionOccurrences,
    sessionSeries: [series],
  }
  return renderToStaticMarkup(
    <SessionCalendar referenceInstant={Date.parse("2026-11-13T04:00:00Z")} selectedDate="2026-11-13" />,
  )
}

function renderMonth(occurrences: TrainingSessionOccurrence[], holiday: AcademyHolidayRecord) {
  return renderToStaticMarkup(
    <MonthGrid
      holidayByDate={new Map([[holiday.dateKey, holiday]])}
      month="2026-11"
      occurrences={occurrences}
      onSelect={() => {}}
      selectedDate="2026-11-13"
      today="2026-11-13"
    />,
  )
}

describe("the month grid on a closed day", () => {
  const diwali = { dateKey: "2026-11-08", id: "holiday-1", label: "Diwali" }

  it("names the holiday when every session there is closed", () => {
    const markup = renderMonth([occurrence("2026-11-08", "cancelled", diwali.id)], diwali)

    expect(markup).toContain('aria-label="Sunday 8 November, closed for Diwali"')
    expect(markup).toContain("<strong>8</strong><small>Diwali</small>")
  })

  // A live session left on a closed day is shown, not hidden behind the
  // holiday, so the grid cannot disagree with the day list underneath it.
  it("still counts a session left scheduled there", () => {
    const markup = renderMonth([occurrence("2026-11-08", "scheduled")], diwali)

    expect(markup).toContain("Sunday 8 November, closed for Diwali, but 1 session is still scheduled")
    expect(markup).toContain("<small>Diwali · 1</small>")
  })

  // The month opens over the week strip and closes on a pick, so the notice
  // of what a holiday change did sits above the day list, not inside it.
  it("keeps the holiday notice above the day list", () => {
    const markup = renderCalendar({ academyHolidays: [diwali], sessionOccurrences: [] })

    const notice = markup.indexOf("inline-notice-slot")
    expect(notice).toBeGreaterThan(-1)
    expect(notice).toBeLessThan(markup.indexOf('id="coach-day-view-title"'))
  })
})

describe("the day list", () => {
  // 13 Nov, 9:30 am in Mumbai: the 6 am session has run, the 5:30 pm one has not.
  it("tags each session from what the data already says, in words", () => {
    const later = { ...occurrence("2026-11-13", "scheduled"), id: "later", startsAt: "2026-11-13T12:00:00.000Z" }
    const off = { ...occurrence("2026-11-13", "cancelled"), id: "off", startsAt: "2026-11-13T13:00:00.000Z" }
    const markup = renderCalendar({
      academyHolidays: [],
      sessionOccurrences: [occurrence("2026-11-13", "scheduled"), later, off],
    })

    expect(markup).toMatch(/data-tone="done">Done</u)
    expect(markup).toContain(">Later today<")
    expect(markup).toMatch(/data-tone="off">Cancelled</u)
    // The month opens in place from the week strip rather than a native picker.
    expect(markup).toMatch(/<button type="button" class="[^"]*">(?:(?!<\/button>).)*<span>Pick a date<\/span><\/button>/u)
    expect(markup).not.toContain('name="attendanceDate"')
  })
})

describe("the calendar after the server turns an action down", () => {
  function captureSessionPortal() {
    let captured: ReturnType<typeof useSessionPortal> | null = null
    function Capture() {
      captured = useSessionPortal()
      return null
    }
    renderToStaticMarkup(<CoachPortalProvider><Capture /></CoachPortalProvider>)
    if (!captured) throw new Error("The session portal was not provided.")
    return captured as ReturnType<typeof useSessionPortal>
  }

  it("refetches when a holiday removal is refused because the day changed elsewhere", async () => {
    portal.actions.retractAcademyHolidayAction.mockResolvedValue({
      code: "NOT_FOUND",
      field: "dateKey",
      message: "That date is not marked as a holiday.",
      ok: false,
    })
    const sessions = captureSessionPortal()

    const result = await sessions.retractAcademyHoliday("2026-11-08")

    expect(result.ok).toBe(false)
    expect(portal.refresh).toHaveBeenCalledOnce()
  })

  it("refetches when a cancellation is refused because the session changed elsewhere", async () => {
    portal.actions.cancelSessionOccurrenceAction.mockResolvedValue({
      code: "CONFLICT",
      field: "occurrenceId",
      message: "This session changed elsewhere. Reload the calendar and try again.",
      ok: false,
    })
    const sessions = captureSessionPortal()

    await sessions.cancelSessionOccurrence("occurrence-1")

    expect(portal.refresh).toHaveBeenCalledOnce()
  })

  it("refetches when a move is refused because the session changed, but not for a field the coach can fix", async () => {
    const sessions = captureSessionPortal()
    const move = {
      dateKey: "2026-11-09",
      durationMinutes: 60,
      occurrenceId: "occurrence-1",
      startTime: "07:00",
      venue: "SMBA Court",
    }

    portal.actions.replaceSessionOccurrenceAction.mockResolvedValueOnce({
      code: "BUSINESS_RULE",
      field: "venue",
      message: "Enter a venue.",
      ok: false,
    })
    await sessions.replaceSessionOccurrence(move)
    expect(portal.refresh).not.toHaveBeenCalled()

    portal.actions.replaceSessionOccurrenceAction.mockResolvedValueOnce({
      code: "CONFLICT",
      field: "occurrenceId",
      message: "This session changed elsewhere. Reload the calendar and try again.",
      ok: false,
    })
    await sessions.replaceSessionOccurrence(move)
    expect(portal.refresh).toHaveBeenCalledOnce()
  })
})

describe("the make-up screen after the server turns a reschedule down", () => {
  it("refetches, so a missed session made up in another tab stops being offered", async () => {
    let captured: ReturnType<typeof useAttendancePortal> | null = null
    function Capture() {
      captured = useAttendancePortal()
      return null
    }
    renderToStaticMarkup(<CoachPortalProvider><Capture /></CoachPortalProvider>)
    portal.actions.publishAttendanceAdjustmentAction.mockResolvedValue({
      code: "CONFLICT",
      field: "sourceOccurrenceId",
      message: "That missed session has already been rescheduled.",
      ok: false,
    })

    await captured!.publishAttendanceAdjustment({
      completionOccurrenceId: "occurrence-2",
      playerId: "player-1",
      sourceOccurrenceId: "occurrence-1",
    })

    expect(portal.refresh).toHaveBeenCalledOnce()
  })
})
