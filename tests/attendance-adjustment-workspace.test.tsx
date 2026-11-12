import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { adjustmentReviewAdvice } from "@/lib/attendance/adjustment-review"

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
  reviewFacts,
}: {
  adjustmentId?: string
  playerId?: string
  reviewFacts?: Record<string, { completionCancelled: boolean; hasPresence: boolean }>
}) {
  return renderToStaticMarkup(
    <AttendanceAdjustmentsWorkspace
      initialAdjustmentId={adjustmentId}
      initialHistoryOpen
      initialPlayerId={playerId}
      reviewFacts={reviewFacts}
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

  it("explains a holiday-cancelled completion and offers to keep the make-up", () => {
    portal.sessionOccurrences = [
      occurrence("monday", "2026-08-10"),
      occurrence("wednesday", "2026-08-12", "cancelled"),
    ]
    portal.attendanceRecords = {
      monday: { "player-a": "absent" },
      wednesday: { "player-a": "present" },
    }
    portal.attendanceAdjustments = [makeUp({ reviewRequiredAt: "2026-08-14T12:00:00.000Z" })]

    const markup = render({
      adjustmentId: "makeup-a",
      playerId: "player-a",
      reviewFacts: { "makeup-a": { completionCancelled: true, hasPresence: true } },
    })

    expect(markup).toContain("was cancelled afterwards, for example by an academy holiday")
    expect(markup).not.toContain("Check the ordinary attendance")
    expect(markup).toContain("Keep make-up")
    expect(markup).toContain("Void make-up")
  })

  it("asks for the Present mark back instead of offering to keep a make-up without one", () => {
    portal.sessionOccurrences = [occurrence("monday", "2026-08-10"), occurrence("wednesday", "2026-08-12")]
    portal.attendanceRecords = {
      monday: { "player-a": "absent" },
      wednesday: { "player-a": "absent" },
    }
    portal.attendanceAdjustments = [makeUp({ reviewRequiredAt: "2026-08-14T12:00:00.000Z" })]

    const markup = render({
      adjustmentId: "makeup-a",
      playerId: "player-a",
      reviewFacts: { "makeup-a": { completionCancelled: false, hasPresence: false } },
    })

    expect(markup).toContain("Mark them Present on that session again, or void the make-up")
    expect(markup).not.toContain("Keep make-up")
    expect(markup).toContain("Void make-up")
  })

  // With no player chosen, marks are loaded for nobody, so the screen used to
  // guess -- and offered a Keep the server refused. The server's answer is the
  // same whoever is selected.
  it("gives the same answer with no player selected", () => {
    portal.sessionOccurrences = [occurrence("monday", "2026-08-10"), occurrence("wednesday", "2026-08-12")]
    portal.attendanceAdjustments = [makeUp({ reviewRequiredAt: "2026-08-14T12:00:00.000Z" })]

    const markup = render({
      adjustmentId: "makeup-a",
      reviewFacts: { "makeup-a": { completionCancelled: false, hasPresence: false } },
    })

    expect(markup).toContain("Mark them Present on that session again, or void the make-up")
    expect(markup).not.toContain("Keep make-up")
  })
})

describe("why a make-up needs review", () => {
  it("names each cause with its own advice", () => {
    const base = { completionCancelled: false, isDateOnly: false, missedCancelled: false }

    expect(adjustmentReviewAdvice({ ...base, presence: "missing" }))
      .toMatchObject({ canKeep: false, cause: "presence-removed" })
    expect(adjustmentReviewAdvice({ ...base, completionCancelled: true, presence: "present" }))
      .toMatchObject({ canKeep: true, cause: "completion-cancelled" })
    expect(adjustmentReviewAdvice({ ...base, missedCancelled: true, presence: "present" }))
      .toMatchObject({ canKeep: true, cause: "missed-cancelled" })
    expect(adjustmentReviewAdvice({ ...base, isDateOnly: true, presence: "unknown" }))
      .toMatchObject({ canKeep: true, cause: "date-only" })
  })

  // The register refuses a cancelled session, so "mark them Present again"
  // would be advice that cannot be followed.
  it("does not ask for a mark that can no longer be made", () => {
    const advice = adjustmentReviewAdvice({
      completionCancelled: true, isDateOnly: false, missedCancelled: false, presence: "missing",
    })
    expect(advice.canKeep).toBe(false)
    expect(advice.message).not.toContain("Mark them Present")
    expect(advice.message).toContain("Void the make-up")
  })

  it("names the holiday for an older make-up whose day was closed", () => {
    expect(adjustmentReviewAdvice({
      completionCancelled: true, isDateOnly: true, missedCancelled: false, presence: "present",
    }).message).toContain("closed as a holiday")
    expect(adjustmentReviewAdvice({
      completionCancelled: false, isDateOnly: true, missedCancelled: false, presence: "missing",
    }).message).not.toContain("the session this make-up was completed at")
  })
})
