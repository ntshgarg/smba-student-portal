import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The reschedule screen, rendered once on the server as it hydrates. Each test
 * sets the portal's data and reads the markup the head coach would see.
 */
const portal = vi.hoisted(() => ({
  attendanceAdjustments: [] as Array<Record<string, unknown>>,
  attendanceRecords: {} as Record<string, Record<string, "absent" | "present">>,
  sessionOccurrences: [] as Array<Record<string, unknown>>,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}))

vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => ({ confirmDiscard: vi.fn(() => true) }),
}))

const weekdayOf = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()

vi.mock("@/components/coach/coach-portal-provider", () => ({
  useAttendancePortal: () => ({
    attendanceAdjustments: portal.attendanceAdjustments,
    attendanceRecords: portal.attendanceRecords,
    keepAttendanceAdjustment: vi.fn(),
    publishAttendanceAdjustment: vi.fn(),
    voidAttendanceAdjustment: vi.fn(),
  }),
  useMemberPortal: () => ({
    players: ["player-a", "player-b"].map((id) => ({
      member: { fullName: `Player ${id.slice(-1).toUpperCase()}`, id, trainingStartOn: "2026-08-01" },
    })),
  }),
  useSessionPortal: () => ({
    sessionAssignments: ["player-a", "player-b"].map((playerId) => ({
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      id: `assignment-${playerId}`,
      playerId,
      seriesId: "series-1",
      weekdays: [weekdayOf("2026-08-10"), weekdayOf("2026-08-12")],
    })),
    sessionOccurrences: portal.sessionOccurrences,
    sessionSeries: [{
      batch: "Weekday",
      endsOn: null,
      id: "series-1",
      programme: "Beginner",
      slots: [],
      startsOn: "2026-08-01",
      status: "active",
      title: "Beginner Weekday",
      venue: "Court 1",
    }],
  }),
}))

const { AttendanceAdjustmentsWorkspace } = await import(
  "@/components/coach/attendance-adjustments-workspace"
)

function occurrence(id: string, dateKey: string, status: "cancelled" | "scheduled" = "scheduled") {
  return {
    durationMinutes: 60,
    eligibilityDate: dateKey,
    id,
    occurrenceDate: dateKey,
    replacementForOccurrenceId: null,
    seriesId: "series-1",
    startsAt: `${dateKey}T00:30:00.000Z`,
    status,
    venue: "Court 1",
  }
}

function makeUp(overrides: Record<string, unknown> = {}) {
  return {
    completedOn: "2026-08-12",
    completionOccurrenceId: "wednesday",
    id: "makeup-a",
    playerId: "player-a",
    publishedAt: "2026-08-12T12:00:00.000Z",
    publishedByAccountId: "coach-1",
    reason: null,
    reviewRequiredAt: null,
    sourceOccurrenceId: "monday",
    type: "makeup",
    voidedAt: null,
    voidedByAccountId: null,
    ...overrides,
  }
}

function render({
  adjustmentId,
  playerId,
}: {
  adjustmentId?: string
  playerId?: string
}) {
  return renderToStaticMarkup(
    <AttendanceAdjustmentsWorkspace
      initialAdjustmentId={adjustmentId}
      initialHistoryOpen
      initialPlayerId={playerId}
      referenceDate="2026-08-20"
      referenceInstant={Date.parse("2026-08-20T12:00:00.000Z")}
    />,
  )
}

describe("reschedule attendance", () => {
  afterEach(() => {
    portal.attendanceAdjustments = []
    portal.attendanceRecords = {}
    portal.sessionOccurrences = []
  })

  // Both players missed Monday. A make-up recorded for A used to hide Monday
  // from B's list too, so B's absence kept counting against him.
  it("still offers a missed session to one player after another player's make-up for it", () => {
    portal.sessionOccurrences = [occurrence("monday", "2026-08-10"), occurrence("wednesday", "2026-08-12")]
    portal.attendanceRecords = {
      monday: { "player-a": "absent", "player-b": "absent" },
      wednesday: { "player-a": "present", "player-b": "present" },
    }
    portal.attendanceAdjustments = [makeUp()]

    const markup = render({ playerId: "player-b" })

    expect(markup).not.toContain("has no unreconciled absences")
    expect(markup).toContain("1 missed session")
  })

  it("still hides the missed session from the player whose make-up it already has", () => {
    portal.sessionOccurrences = [occurrence("monday", "2026-08-10"), occurrence("wednesday", "2026-08-12")]
    portal.attendanceRecords = {
      monday: { "player-a": "absent" },
      wednesday: { "player-a": "present" },
    }
    portal.attendanceAdjustments = [makeUp()]

    expect(render({ playerId: "player-a" })).toContain("Player A has no unreconciled absences")
  })

  it("does not offer a make-up's completed session as a missed session", () => {
    portal.sessionOccurrences = [occurrence("monday", "2026-08-10"), occurrence("wednesday", "2026-08-12")]
    // Wednesday's Present was changed to Absent after it proved Monday's make-up.
    portal.attendanceRecords = {
      monday: { "player-a": "absent" },
      wednesday: { "player-a": "absent" },
    }
    portal.attendanceAdjustments = [makeUp({ reviewRequiredAt: "2026-08-14T12:00:00.000Z" })]

    expect(render({ playerId: "player-a" })).toContain("Player A has no unreconciled absences")
  })

  it("offers to keep or void a make-up that needs review", () => {
    portal.sessionOccurrences = [
      occurrence("monday", "2026-08-10"),
      occurrence("wednesday", "2026-08-12", "cancelled"),
    ]
    portal.attendanceRecords = {
      monday: { "player-a": "absent" },
      wednesday: { "player-a": "present" },
    }
    portal.attendanceAdjustments = [makeUp({ reviewRequiredAt: "2026-08-14T12:00:00.000Z" })]

    const markup = render({ adjustmentId: "makeup-a", playerId: "player-a" })

    expect(markup).toContain("This adjustment requires review.")
    expect(markup).toContain("Keep make-up")
    expect(markup).toContain("Void adjustment")
  })
})
