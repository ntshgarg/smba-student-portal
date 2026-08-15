import { describe, expect, it } from "vitest"

import { buildJuniorCoachAttendanceCalendar } from "@/components/coach/junior-coach-attendance-calendar"

describe("Junior coach attendance month calendar", () => {
  it("builds a Monday-first grid and preserves each daily attendance state", () => {
    const calendar = buildJuniorCoachAttendanceCalendar({
      joinedOn: "2026-08-01",
      referenceDate: "2026-08-11",
      records: [
        { choice: "present", dateKey: "2026-08-01" },
        { choice: "absent", dateKey: "2026-08-04" },
        { choice: "cleared", dateKey: "2026-08-06" },
      ],
      years: [2025, 2026, 2027],
    }, 2026, 8)

    expect(calendar.days).toHaveLength(42)
    expect(calendar.firstCalendarDate).toBe("2026-07-27")
    expect(calendar.lastCalendarDate).toBe("2026-09-06")
    expect(calendar.days.find((day) => day.key === "2026-08-01")?.state).toBe("present")
    expect(calendar.days.find((day) => day.key === "2026-08-04")?.state).toBe("absent")
    expect(calendar.days.find((day) => day.key === "2026-08-05")?.state).toBe("unmarked")
    expect(calendar.days.find((day) => day.key === "2026-08-06")?.state).toBe("unmarked")
    expect(calendar.days.find((day) => day.key === "2026-08-11")?.isToday).toBe(true)
    expect(calendar.days.find((day) => day.key === "2026-07-31")?.state).toBe("unavailable")
    expect(calendar.days.find((day) => day.key === "2026-08-12")?.state).toBe("unavailable")
  })
})
