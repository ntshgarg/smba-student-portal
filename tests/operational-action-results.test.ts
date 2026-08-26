import { readFileSync } from "node:fs"
import path from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  approveRegistration: vi.fn(),
  assignSessionRecords: vi.fn(),
  cancelSessionOccurrence: vi.fn(),
  createSessionSeriesRecords: vi.fn(),
  endSessionAssignment: vi.fn(),
  endSessionSeriesRecords: vi.fn(),
  findScheduledOccurrence: vi.fn(),
  getCoachCalendarMonthSessionSnapshot: vi.fn(),
  getCoachSessionSnapshot: vi.fn(),
  initializeDatabase: vi.fn(),
  publishMakeupAttendanceAdjustment: vi.fn(),
  rejectRegistration: vi.fn(),
  replaceSessionOccurrence: vi.fn(),
  requireHeadAdminAction: vi.fn(),
  revalidatePath: vi.fn(),
  saveSessionAttendanceRecords: vi.fn(),
  saveStaffAttendanceRecords: vi.fn(),
  voidAttendanceAdjustment: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth/account-service", () => ({
  approveRegistration: mocks.approveRegistration,
  rejectRegistration: mocks.rejectRegistration,
}))
vi.mock("@/lib/auth/current-coach", () => ({
  requireHeadAdminAction: mocks.requireHeadAdminAction,
}))
vi.mock("@/lib/attendance/adjustments", () => ({
  publishMakeupAttendanceAdjustment: mocks.publishMakeupAttendanceAdjustment,
  voidAttendanceAdjustment: mocks.voidAttendanceAdjustment,
}))
vi.mock("@/lib/coach/database", () => ({
  getCoachSessionSnapshot: mocks.getCoachSessionSnapshot,
  listCoachMonthlyReports: vi.fn(() => []),
}))
vi.mock("@/lib/coach/session-read-models", () => ({
  getCoachCalendarMonthSessionSnapshot: mocks.getCoachCalendarMonthSessionSnapshot,
}))
vi.mock("@/lib/coach/member-service", () => ({
  archiveMemberRecord: vi.fn(),
  updateMemberRecord: vi.fn(),
}))
vi.mock("@/lib/coach/staff-attendance", () => ({
  saveStaffAttendanceRecords: mocks.saveStaffAttendanceRecords,
}))
vi.mock("@/lib/db/client", () => ({
  initializeDatabase: mocks.initializeDatabase,
}))
vi.mock("@/lib/sessions/database", () => ({
  findScheduledOccurrence: mocks.findScheduledOccurrence,
}))
vi.mock("@/lib/sessions/service", () => ({
  assignSessionRecords: mocks.assignSessionRecords,
  cancelSessionOccurrence: mocks.cancelSessionOccurrence,
  createSessionSeriesRecords: mocks.createSessionSeriesRecords,
  endSessionAssignment: mocks.endSessionAssignment,
  endSessionSeriesRecords: mocks.endSessionSeriesRecords,
  replaceSessionOccurrence: mocks.replaceSessionOccurrence,
  saveSessionAttendanceRecords: mocks.saveSessionAttendanceRecords,
}))

import {
  approveRegistrationAction,
  createSessionSeriesAction,
  replaceSessionOccurrenceAction,
  saveAttendanceRegisterAction,
  saveStaffAttendanceAction,
} from "@/app/coach/actions"
import { publishAttendanceAdjustmentAction } from "@/app/coach/attendance/adjustments/actions"
import {
  OperationalActionError,
  SessionExpiredError,
} from "@/lib/actions/operational-result"
import type { StaffAttendanceChange } from "@/lib/coach/staff-attendance"
import type { SessionAttendanceChange } from "@/lib/sessions/types"

const snapshot = {
  sessionAssignments: [],
  sessionOccurrences: [],
  sessionSeries: [],
}

const registerMarks: SessionAttendanceChange[] = [
  {
    choice: "present",
    expectedChoice: "cleared",
    occurrenceId: "occurrence-1",
    playerId: "player-1",
  },
]

const rollCallMarks: StaffAttendanceChange[] = [
  {
    choice: "present",
    coachAccountId: "coach-2",
    dateKey: "2026-08-21",
    expectedChoice: "cleared",
  },
]

describe("production-safe operational action results", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireHeadAdminAction.mockResolvedValue({ subjectId: "coach-1" })
    mocks.initializeDatabase.mockReturnValue({})
    mocks.findScheduledOccurrence.mockReturnValue({ occurrenceDate: "2026-08-12" })
    mocks.getCoachCalendarMonthSessionSnapshot.mockReturnValue(snapshot)
    mocks.getCoachSessionSnapshot.mockReturnValue(snapshot)
  })

  it("returns a structured replacement field error without revalidating", async () => {
    mocks.replaceSessionOccurrence.mockImplementation(() => {
      throw new OperationalActionError(
        "INVALID_INPUT",
        "Choose a valid session duration.",
        "durationMinutes",
      )
    })

    await expect(replaceSessionOccurrenceAction({
      occurrenceId: "occurrence-1",
      dateKey: "2026-08-12",
      startTime: "07:00",
      durationMinutes: Number.NaN,
      venue: "SMBA Court",
    })).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "durationMinutes",
      message: "Choose a valid session duration.",
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("returns crafted schedule category failures as structured action data", async () => {
    mocks.createSessionSeriesRecords.mockImplementation(() => {
      throw new OperationalActionError(
        "INVALID_INPUT",
        "Choose a valid training programme.",
        "programme",
      )
    })

    await expect(createSessionSeriesAction({
      programme: "Elite",
      batch: "Weekday",
      venue: "SMBA Court",
      startsOn: "2026-08-17",
      endsOn: "2026-08-31",
      weekdays: [1],
      startTime: "06:00",
      durationMinutes: 60,
    } as never)).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "programme",
      message: "Choose a valid training programme.",
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("keeps unexpected and authorization failures throwable", async () => {
    mocks.replaceSessionOccurrence.mockImplementationOnce(() => {
      throw new Error("database unavailable")
    })
    await expect(replaceSessionOccurrenceAction({
      occurrenceId: "occurrence-1",
      dateKey: "2026-08-12",
      startTime: "07:00",
      durationMinutes: 60,
      venue: "SMBA Court",
    })).rejects.toThrow("database unavailable")

    mocks.requireHeadAdminAction.mockRejectedValueOnce(new Error("Head coach access is required."))
    await expect(approveRegistrationAction("registration-1", "player"))
      .rejects.toThrow("Head coach access is required.")
    expect(mocks.approveRegistration).not.toHaveBeenCalled()
  })

  it("hands an expired session to the register as data, not as a throw", async () => {
    mocks.requireHeadAdminAction.mockRejectedValueOnce(new SessionExpiredError())

    await expect(saveAttendanceRegisterAction({ changes: registerMarks })).resolves.toEqual({
      ok: false,
      code: "SESSION_EXPIRED",
      field: undefined,
      message: "Your sign-in expired. Sign in again to continue.",
    })
    // The guard threw before the wrapper caught it, so the marks were never
    // written and nothing was revalidated -- the conversion is at the boundary,
    // not inside the mutation.
    expect(mocks.saveSessionAttendanceRecords).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  // The staff roll call is the register a head coach fills courtside while a
  // session runs, and it is the second surface moved onto the shared
  // conversion. Without it the guard's throw crosses the server-action
  // boundary, where React replaces the class, the message and every own
  // property with a fixed sentence and a digest.
  it("hands an expired session to the staff roll call as data as well", async () => {
    mocks.requireHeadAdminAction.mockRejectedValueOnce(new SessionExpiredError())

    await expect(saveStaffAttendanceAction({ changes: rollCallMarks })).resolves.toEqual({
      ok: false,
      code: "SESSION_EXPIRED",
      field: undefined,
      message: "Your sign-in expired. Sign in again to continue.",
    })
    expect(mocks.saveStaffAttendanceRecords).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("still throws a head-coach refusal out of the staff roll call", async () => {
    mocks.requireHeadAdminAction.mockRejectedValueOnce(
      new Error("Head coach access is required."),
    )

    await expect(saveStaffAttendanceAction({ changes: rollCallMarks }))
      .rejects.toThrow("Head coach access is required.")
    expect(mocks.saveStaffAttendanceRecords).not.toHaveBeenCalled()
  })

  it("still throws a head-coach refusal out of the same wrapped action", async () => {
    mocks.requireHeadAdminAction.mockRejectedValueOnce(
      new Error("Head coach access is required."),
    )

    await expect(saveAttendanceRegisterAction({ changes: registerMarks }))
      .rejects.toThrow("Head coach access is required.")
    expect(mocks.saveSessionAttendanceRecords).not.toHaveBeenCalled()
  })

  it("returns only the source calendar month after a successful replacement", async () => {
    mocks.replaceSessionOccurrence.mockReset()
    await expect(replaceSessionOccurrenceAction({
      occurrenceId: "occurrence-1",
      dateKey: "2026-09-02",
      startTime: "07:00",
      durationMinutes: 60,
      venue: "SMBA Court",
    })).resolves.toEqual({ ok: true, data: snapshot })

    expect(mocks.getCoachCalendarMonthSessionSnapshot).toHaveBeenCalledOnce()
    expect(mocks.getCoachCalendarMonthSessionSnapshot).toHaveBeenCalledWith("2026-08")
    expect(mocks.getCoachSessionSnapshot).not.toHaveBeenCalled()
  })

  it("returns expected registration and adjustment conflicts as data", async () => {
    mocks.approveRegistration.mockImplementation(() => {
      throw new OperationalActionError(
        "NOT_FOUND",
        "This registration is no longer pending.",
        "registrationId",
      )
    })
    await expect(approveRegistrationAction("registration-1", "player")).resolves.toMatchObject({
      ok: false,
      code: "NOT_FOUND",
      field: "registrationId",
    })

    mocks.publishMakeupAttendanceAdjustment.mockImplementation(() => {
      throw new OperationalActionError(
        "CONFLICT",
        "This absence already has a published adjustment.",
        "sourceOccurrenceId",
      )
    })
    await expect(publishAttendanceAdjustmentAction({
      completionOccurrenceId: "completion-occurrence-1",
      playerId: "player-1",
      sourceOccurrenceId: "occurrence-1",
    })).resolves.toMatchObject({
      ok: false,
      code: "CONFLICT",
      field: "sourceOccurrenceId",
    })
  })

  it("approves a junior-coach request with an explicit role guard", async () => {
    mocks.approveRegistration.mockReturnValue({
      academyId: "SMBA-JC-4827",
      fullName: "Arjun Kumar",
      role: "coach",
    })

    await expect(approveRegistrationAction("registration-1", "coach")).resolves.toEqual({
      ok: true,
      data: {
        academyId: "SMBA-JC-4827",
        fullName: "Arjun Kumar",
        role: "coach",
      },
    })
    expect(mocks.approveRegistration).toHaveBeenCalledWith(
      "registration-1",
      "coach-1",
      { requestedRole: "coach" },
    )
  })
})

describe("replacement field accessibility", () => {
  it("associates expected field failures and focuses the first invalid input", () => {
    const calendar = readFileSync(path.join(
      process.cwd(),
      "components/coach/calendar/session-calendar.tsx",
    ), "utf8")

    expect(calendar).toContain('feedback.field === "durationMinutes"')
    expect(calendar).toContain("durationInputRef.current?.focus()")
    expect(calendar).toContain('aria-invalid={feedback?.field === "durationMinutes" || undefined}')
    expect(calendar).toContain('aria-describedby={feedback?.field === "durationMinutes" ? feedbackId : undefined}')
  })

  it("associates and focuses field failures in schedule and adjustment editors", () => {
    const scheduleCreate = readFileSync(path.join(
      process.cwd(),
      "components/coach/calendar/session-create.tsx",
    ), "utf8")
    const schedules = readFileSync(path.join(
      process.cwd(),
      "components/coach/calendar/session-schedules.tsx",
    ), "utf8")
    const adjustments = readFileSync(path.join(
      process.cwd(),
      "components/coach/attendance-adjustments-workspace.tsx",
    ), "utf8")

    expect(scheduleCreate).toContain("field: result.field")
    expect(scheduleCreate).toContain('feedback?.field === "venue"')
    expect(scheduleCreate).toContain("fieldTargets[feedback.field]?.focus()")
    expect(schedules).toContain("field: result.field")
    expect(schedules).toContain('rosterFeedback.field === "weekdays"')
    expect(schedules).toContain("assignmentDateRef.current?.focus()")
    expect(adjustments).toContain("field: result.field")
    expect(adjustments).toContain('feedback.field === "sourceOccurrenceId"')
    expect(adjustments).toContain('aria-invalid={feedback?.field === "completionOccurrenceId" || undefined}')
    expect(adjustments).toContain('attendanceRecords[occurrence.id]?.[selectedPlayerId] === "present"')
    expect(adjustments).toContain("completionOccurrenceId,")
  })
})
