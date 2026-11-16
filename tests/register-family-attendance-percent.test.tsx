import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { calculateMonthlyAttendance } from "@/lib/attendance/domain"

/**
 * The coach's register and the family's own page must show the same monthly %
 * for the same player: a missed session that was made up counts as attended on
 * both. Three present and one made-up absence is 100%, not 75%.
 */
const PLAYER_ID = "player-1"
const DATES = ["2026-07-06", "2026-07-08", "2026-07-13", "2026-07-15"]
const OCCURRENCES = DATES.map((date, index) => ({
  durationMinutes: 90,
  eligibilityDate: date,
  id: `occurrence-${index + 1}`,
  occurrenceDate: date,
  replacementForOccurrenceId: null,
  seriesId: "series-1",
  startsAt: `${date}T11:30:00.000Z`,
  status: "scheduled" as const,
  venue: "Court 1",
}))
const ASSIGNMENT = {
  effectiveFrom: "2026-07-01",
  effectiveTo: null,
  id: "assignment-1",
  playerId: PLAYER_ID,
  seriesId: "series-1",
  weekdays: [1, 3],
}
const RECORDS = {
  "occurrence-1": { [PLAYER_ID]: "present" as const },
  "occurrence-2": { [PLAYER_ID]: "absent" as const },
  "occurrence-3": { [PLAYER_ID]: "present" as const },
  "occurrence-4": { [PLAYER_ID]: "present" as const },
}
const MAKEUP = {
  completedOn: "2026-07-10",
  id: "adjustment-1",
  playerId: PLAYER_ID,
  reviewRequiredAt: null,
  sourceOccurrenceId: "occurrence-2",
  voidedAt: null,
}

vi.mock("next/navigation", () => ({
  usePathname: () => "/coach/attendance/players/register",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/components/coach/coach-portal-provider", () => ({
  useAttendancePortal: () => ({
    attendanceAdjustments: [MAKEUP],
    attendanceRecords: RECORDS,
  }),
  useMemberPortal: () => ({
    players: [{ member: { fullName: "Asha Rao", id: PLAYER_ID, trainingStartOn: "2026-07-01" } }],
  }),
  useSessionPortal: () => ({
    academyHolidays: [],
    sessionAssignments: [ASSIGNMENT],
    sessionOccurrences: OCCURRENCES,
    sessionSeries: [{
      batch: "Weekday",
      endsOn: null,
      id: "series-1",
      programme: "Beginner",
      slots: [
        { durationMinutes: 90, startTime: "17:00", weekday: 1 },
        { durationMinutes: 90, startTime: "17:00", weekday: 3 },
      ],
      startsOn: "2026-07-01",
      status: "active" as const,
      title: "Beginner Weekday",
      venue: "Court 1",
    }],
  }),
}))

const { PlayerAttendanceRegister } = await import("@/components/coach/player-attendance-register")

describe("the register's monthly %", () => {
  // The % itself is worked out on the server by the family page's function
  // (tests/attendance-month-range.test.ts holds that); the register shows it.
  it("shows the family page's figure: a made-up absence counts as attended", () => {
    // What the family page computes from the same marks (lib/attendance/database.ts).
    const family = calculateMonthlyAttendance({
      month: "2026-07",
      referenceDate: "2026-07-31",
      referenceInstant: "2026-07-31T12:00:00.000Z",
      joinedOn: "2026-07-01",
      assignments: [ASSIGNMENT],
      occurrences: OCCURRENCES,
      records: Object.entries(RECORDS).map(([occurrenceId, marks]) => ({
        occurrenceId,
        choice: marks[PLAYER_ID],
      })),
      adjustments: [MAKEUP],
    })
    expect(family.percentage).toBe(100)

    const html = renderToStaticMarkup(
      <PlayerAttendanceRegister
        month={7}
        monthlyPercents={{ [PLAYER_ID]: family.percentage }}
        referenceDate="2026-07-31"
        referenceInstant={Date.parse("2026-07-31T12:00:00.000Z")}
        selection={{ batch: "Weekday", programme: "Beginner", year: 2026 }}
        yearOptions={[2026]}
      />,
    )

    expect(html).toContain(`${family.percentage}% attended in July 2026`)
    expect(html).not.toContain("75%")
  })
})
