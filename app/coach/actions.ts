"use server"

import { revalidatePath } from "next/cache"

import {
  approveRegistration,
  rejectRegistration,
} from "@/lib/auth/account-service"
import {
  OperationalActionError,
  operationalActionFailure,
  type OperationalActionResult,
} from "@/lib/actions/operational-result"
import { requireHeadAdminAction } from "@/lib/auth/current-coach"
import { getCoachSessionSnapshot, listCoachMonthlyReports } from "@/lib/coach/database"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import { getCoachCalendarMonthSessionSnapshot } from "@/lib/coach/session-read-models"
import {
  saveStaffAttendanceRecords,
  type StaffAttendanceChange,
} from "@/lib/coach/staff-attendance"
import type {
  ArchiveMemberInput,
  ArchiveMemberResult,
  MemberMutationResult,
  UpdateMemberInput,
} from "@/lib/coach/types"
import {
  archiveMemberRecord,
  updateMemberRecord,
} from "@/lib/coach/member-service"
import { initializeDatabase } from "@/lib/db/client"
import {
  findScheduledOccurrence,
} from "@/lib/sessions/database"
import {
  assignSessionRecords,
  cancelSessionOccurrence,
  createSessionSeriesRecords,
  endSessionAssignment,
  endSessionSeriesRecords,
  replaceSessionOccurrence,
  saveSessionAttendanceRecords,
} from "@/lib/sessions/service"
import type {
  CreateSessionSeriesInput,
  SessionAttendanceChange,
} from "@/lib/sessions/types"
import type {
  PublishReportInput,
  ReportMutationResult,
  SaveReportDraftInput,
} from "@/lib/reports/contracts"
import {
  publishMonthlyReport,
  ReportServiceError,
  saveMonthlyReportDraft,
} from "@/lib/reports/service"

async function requireCoach() {
  return requireHeadAdminAction()
}

function runOperationalAction<T>(operation: () => T): OperationalActionResult<T> {
  try {
    return { ok: true, data: operation() }
  } catch (error) {
    if (error instanceof OperationalActionError) {
      return operationalActionFailure(error)
    }
    throw error
  }
}

function revalidateAcademyData() {
  revalidatePath("/coach")
  revalidatePath("/coach/attendance/players/register")
  revalidatePath("/coach/attendance/players/record")
  revalidatePath("/coach/attendance/staff/register")
  revalidatePath("/coach/attendance/staff/record")
  revalidatePath("/coach/attendance/adjustments")
  revalidatePath("/coach/calendar")
  revalidatePath("/coach/schedules")
  revalidatePath("/coach/schedules/new")
  revalidatePath("/coach/members")
  revalidatePath("/coach/onboarding")
  revalidatePath("/coach/reports")
  revalidatePath("/coach/reports/write")
  revalidatePath("/coach/financials")
  revalidatePath("/player")
  revalidatePath("/player/financials")
  revalidatePath("/player/reports")
  revalidatePath("/")
  revalidatePath("/reports")
}

export async function approveRegistrationAction(registrationId: string) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    if (typeof registrationId !== "string" || !registrationId.trim()) {
      throw new OperationalActionError(
        "NOT_FOUND",
        "This registration is no longer pending.",
        "registrationId",
      )
    }
    const approved = approveRegistration(registrationId, coach.subjectId, {
      requestedRole: "player",
    })
    revalidateAcademyData()
    return approved
  })
}

export async function rejectRegistrationAction(registrationId: string) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    if (typeof registrationId !== "string" || !registrationId.trim()) {
      throw new OperationalActionError(
        "NOT_FOUND",
        "This registration is no longer pending.",
        "registrationId",
      )
    }
    rejectRegistration(registrationId, coach.subjectId)
    revalidateAcademyData()
    return null
  })
}

export async function saveMemberAction(
  input: UpdateMemberInput,
): Promise<MemberMutationResult> {
  const coach = await requireCoach()
  const result = updateMemberRecord({
    coachId: coach.subjectId,
    database: initializeDatabase(),
    input,
  })
  if (result.ok) revalidateAcademyData()
  return result
}

export async function archiveMemberAction(
  input: ArchiveMemberInput,
): Promise<ArchiveMemberResult> {
  const coach = await requireCoach()
  const result = archiveMemberRecord({
    coachId: coach.subjectId,
    database: initializeDatabase(),
    input,
  })
  if (result.ok) revalidateAcademyData()
  return result
}

export async function saveAttendanceRegisterAction(input: {
  changes: SessionAttendanceChange[]
}) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    if (!Array.isArray(input?.changes) || !input.changes.length) return { applied: 0 }
    const db = initializeDatabase()
    const now = new Date()
    const result = saveSessionAttendanceRecords({
      changes: input.changes,
      coachId: coach.subjectId,
      database: db,
      now,
      referenceDate: getIndiaDateKey(now),
    })
    revalidateAcademyData()
    return result
  })
}

export async function saveStaffAttendanceAction(input: {
  changes: StaffAttendanceChange[]
}) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    if (!Array.isArray(input?.changes) || !input.changes.length) {
      return { applied: 0 }
    }
    const result = saveStaffAttendanceRecords({
      changes: input.changes,
      markedByAccountId: coach.subjectId,
      now: new Date(),
    })
    revalidatePath("/coach")
    revalidatePath("/coach/attendance/staff/register")
    revalidatePath("/coach/attendance/staff/record")
    return result
  })
}

export async function createSessionSeriesAction(input: CreateSessionSeriesInput) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    const db = initializeDatabase()
    const now = new Date()
    const id = createSessionSeriesRecords({
      coachId: coach.subjectId,
      database: db,
      input,
      now,
    })
    revalidateAcademyData()
    return { createdSeriesId: id, ...getCoachSessionSnapshot() }
  })
}

export async function assignSessionAction(input: {
  effectiveFrom: string
  playerId: string
  seriesId: string
  weekdays: number[]
}) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    assignSessionRecords({
      coachId: coach.subjectId,
      database: initializeDatabase(),
      ...input,
      now: new Date(),
    })
    revalidateAcademyData()
    return getCoachSessionSnapshot()
  })
}

export async function endSessionAssignmentAction(input: {
  assignmentId: string
  effectiveTo: string
}) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    endSessionAssignment({
      coachId: coach.subjectId,
      database: initializeDatabase(),
      ...input,
      now: new Date(),
    })
    revalidateAcademyData()
    return getCoachSessionSnapshot()
  })
}

export async function endSessionSeriesAction(seriesId: string) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    endSessionSeriesRecords({
      coachId: coach.subjectId,
      database: initializeDatabase(),
      now: new Date(),
      seriesId,
    })
    revalidateAcademyData()
    return getCoachSessionSnapshot()
  })
}

export async function cancelSessionOccurrenceAction(occurrenceId: string) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    const now = new Date()
    const sourceOccurrence = findScheduledOccurrence(occurrenceId)
    cancelSessionOccurrence({
      coachId: coach.subjectId,
      database: initializeDatabase(),
      now,
      occurrenceId,
      referenceDate: getIndiaDateKey(now),
    })
    revalidateAcademyData()
    if (!sourceOccurrence) throw new Error("The cancelled session could not be reloaded.")
    return getCoachCalendarMonthSessionSnapshot(sourceOccurrence.occurrenceDate.slice(0, 7))
  })
}

export async function replaceSessionOccurrenceAction(input: {
  occurrenceId: string
  dateKey: string
  startTime: string
  durationMinutes: number
  venue: string
}) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    const sourceOccurrence = findScheduledOccurrence(input.occurrenceId)
    replaceSessionOccurrence({
      ...input,
      coachId: coach.subjectId,
      database: initializeDatabase(),
      now: new Date(),
      referenceDate: getIndiaDateKey(),
    })
    revalidateAcademyData()
    if (!sourceOccurrence) throw new Error("The replaced session could not be reloaded.")
    return getCoachCalendarMonthSessionSnapshot(sourceOccurrence.occurrenceDate.slice(0, 7))
  })
}

function reportMutationFailure(error: ReportServiceError): ReportMutationResult {
  return {
    ok: false,
    code: error.code,
    field: error.field,
    message: error.message,
  }
}

function reportMutationSuccess(reportId: string): ReportMutationResult {
  const report = listCoachMonthlyReports().find((item) => item.id === reportId)
  if (!report) throw new Error("The saved report could not be reloaded.")
  return { ok: true, report }
}

export async function saveReportDraftAction(
  input: SaveReportDraftInput,
): Promise<ReportMutationResult> {
  const coach = await requireCoach()
  try {
    const { reportId } = saveMonthlyReportDraft(input, { coachId: coach.subjectId })
    revalidatePath("/coach/reports/write")
    return reportMutationSuccess(reportId)
  } catch (error) {
    if (error instanceof ReportServiceError) return reportMutationFailure(error)
    throw error
  }
}

export async function publishReportAction(
  input: PublishReportInput,
): Promise<ReportMutationResult> {
  const coach = await requireCoach()
  try {
    const { reportId } = publishMonthlyReport(input, { coachId: coach.subjectId })
    revalidateAcademyData()
    return reportMutationSuccess(reportId)
  } catch (error) {
    if (error instanceof ReportServiceError) return reportMutationFailure(error)
    throw error
  }
}
