"use server"

import { revalidatePath } from "next/cache"

import {
  approveRegistration,
  rejectRegistration,
} from "@/lib/auth/account-service"
import { runCoachAction } from "@/lib/actions/coach-session"
import {
  OperationalActionError,
  operationalActionFailure,
  type OperationalActionResult,
} from "@/lib/actions/operational-result"
import { requireHeadAdminAction } from "@/lib/auth/current-coach"
import { listCoachMonthlyReports } from "@/lib/coach/database"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import {
  getCoachCalendarMonthSessionSnapshot,
  getCoachScheduleMutationSnapshot,
} from "@/lib/coach/session-read-models"
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

/**
 * The bare guard, for the actions this file has not moved onto
 * `runCoachAction` yet. Both attendance registers have moved; the other 12
 * exports here still throw an expiry across the server-action boundary, where
 * React replaces it with a fixed sentence and a digest.
 */
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

/**
 * `/reports` is deliberately absent: the page is a bare
 * `redirect("/player/reports")`, and that target is already in this list.
 *
 * `/` stays, and the reason is worth recording because the obvious reading says it
 * should not. The homepage reads no academy data on the server -- its fee table is
 * the compile-time `monthlyFeePaise` table in `lib/finance/config.ts`, and its
 * announcements are fetched in the browser from `/api/public/announcements`, which
 * is `force-dynamic` and so never written to the incremental cache. (That endpoint's
 * freshness comes solely from the `s-maxage=60, stale-while-revalidate=300` header
 * it sets on every response; the `revalidatePath("/api/public/announcements")` in
 * `app/coach/announcements/actions.ts` is inert. Do not delete that header believing
 * a revalidation covers it.)
 *
 * But the footer renders `new Date().getFullYear()`, evaluated once at static
 * generation, so something has to expire the page or the copyright line reads a year
 * behind from every 1 January. The first attempt gave the page its own
 * `export const revalidate = 86400` and dropped it from this list. That works for the
 * year and breaks the application: it turns `/` from a fully static route into an ISR
 * one, and the client router then re-prefetches it without settling. Every
 * `<Link href={publicSiteUrl}>` becomes a request that never stops -- there are 13 of
 * them, including in `components/app-shell.tsx` and `components/coach/coach-shell.tsx`,
 * so essentially every page is affected. Measured against the stress fixture:
 * `page.goto("/login", { waitUntil: "networkidle" })` timed out at 60s with the
 * `revalidate` export and passed in 3.5s without it.
 *
 * So the cheap-looking win is not available. One `revalidatePath` on a route that
 * holds no coach-written data is the price of a correct copyright year, and it is far
 * cheaper than the alternative.
 */
function revalidateAcademyData() {
  revalidatePath("/")
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
}

export async function approveRegistrationAction(
  registrationId: string,
  requestedRole: "player" | "coach",
) {
  const coach = await requireCoach()
  return runOperationalAction(() => {
    if (typeof registrationId !== "string" || !registrationId.trim()) {
      throw new OperationalActionError(
        "NOT_FOUND",
        "This registration is no longer pending.",
        "registrationId",
      )
    }
    if (requestedRole !== "player" && requestedRole !== "coach") {
      throw new OperationalActionError(
        "INVALID_INPUT",
        "Choose a valid account type.",
        "requestedRole",
      )
    }
    const approved = approveRegistration(registrationId, coach.subjectId, { requestedRole })
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
  return runCoachAction((coach) => runOperationalAction(() => {
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
  }))
}

export async function saveStaffAttendanceAction(input: {
  changes: StaffAttendanceChange[]
}) {
  return runCoachAction((coach) => runOperationalAction(() => {
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
  }))
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
    return { createdSeriesId: id, ...getCoachScheduleMutationSnapshot() }
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
    return getCoachScheduleMutationSnapshot()
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
    return getCoachScheduleMutationSnapshot()
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
    return getCoachScheduleMutationSnapshot()
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

/**
 * `upsertDraft` keys the row on `(accountId, month)` and returns that row's id
 * (`lib/reports/service.ts:125`), so the saved report is always in the month
 * the caller submitted -- reloading it does not need the archive of every month
 * the academy has ever written.
 */
function reportMutationSuccess(reportId: string, month: string): ReportMutationResult {
  const report = listCoachMonthlyReports(month).find((item) => item.id === reportId)
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
    return reportMutationSuccess(reportId, input.month)
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
    return reportMutationSuccess(reportId, input.month)
  } catch (error) {
    if (error instanceof ReportServiceError) return reportMutationFailure(error)
    throw error
  }
}
