import { occurrenceHasStarted } from "@/lib/sessions/occurrence-time"
import {
  isValidDateKey,
  isValidMonthKey,
} from "@/lib/date-keys"
import {
  assignmentCoversOccurrence,
  playerWasEnrolledForOccurrence,
} from "@/lib/sessions/domain"

export {
  isValidDateKey,
  isValidMonthKey,
  weekdayForDateKey,
} from "@/lib/date-keys"

export type AttendanceDomainRecord = {
  occurrenceId: string
  choice: "present" | "absent" | "cleared"
}

export type AttendanceBreakdown = {
  eligible: number
  recorded: number
  attended: number
  absent: number
  pending: number
  percentage: number | null
}

export type AttendanceAdjustmentDomainRecord = {
  id: string
  sourceOccurrenceId: string
}

export type AttendanceSnapshotV1 = AttendanceBreakdown & {
  version: 1
  month: string
  referenceDate: string
}

export type AttendanceSnapshotV2 = AttendanceBreakdown & {
  version: 2
  source: "session-occurrences"
  month: string
  referenceDate: string
}

export type AttendanceSnapshotV3 = AttendanceBreakdown & {
  version: 3
  source: "session-occurrences"
  month: string
  referenceDate: string
  referenceInstant: string
}

export type AttendanceSnapshotV4 = AttendanceBreakdown & {
  version: 4
  source: "session-occurrences"
  month: string
  referenceDate: string
  referenceInstant: string
  adjustmentPolicyVersion: 1
  appliedAdjustmentIds: string[]
}

export type AttendanceSnapshot =
  | AttendanceSnapshotV1
  | AttendanceSnapshotV2
  | AttendanceSnapshotV3
  | AttendanceSnapshotV4

export type MonthlyAttendanceInput = {
  month: string
  referenceDate: string
  referenceInstant?: string
  joinedOn: string
  assignments: Array<{
    seriesId: string
    effectiveFrom: string
    effectiveTo: string | null
    weekdays: number[]
  }>
  occurrences: Array<{
    id: string
    seriesId: string
    occurrenceDate: string
    eligibilityDate: string
    startsAt?: string
    status: "scheduled" | "cancelled"
  }>
  records: AttendanceDomainRecord[]
  adjustments?: AttendanceAdjustmentDomainRecord[]
}

type AttendanceCalculationResult = {
  breakdown: AttendanceBreakdown
  appliedAdjustmentIds: string[]
}

export function assertAttendanceBreakdown(
  value: AttendanceBreakdown,
): asserts value is AttendanceBreakdown {
  const totals = [
    value.eligible,
    value.recorded,
    value.attended,
    value.absent,
    value.pending,
  ]
  if (totals.some((total) => !Number.isInteger(total) || total < 0)) {
    throw new Error("Attendance totals must be non-negative integers.")
  }
  if (value.recorded !== value.attended + value.absent) {
    throw new Error("Recorded attendance must equal attended plus absent.")
  }
  if (value.eligible !== value.recorded + value.pending) {
    throw new Error("Eligible attendance must equal recorded plus pending.")
  }
  if (value.recorded === 0 && value.percentage !== null) {
    throw new Error("Attendance percentage must be null when nothing is recorded.")
  }
  if (value.recorded > 0 && (
    !Number.isInteger(value.percentage)
    || (value.percentage as number) < 0
    || (value.percentage as number) > 100
  )) {
    throw new Error("Attendance percentage must be an integer from 0 to 100.")
  }
}

function calculateMonthlyAttendanceResult({
  adjustments = [],
  assignments,
  joinedOn,
  month,
  occurrences,
  records,
  referenceDate,
  referenceInstant,
}: MonthlyAttendanceInput): AttendanceCalculationResult {
  if (!isValidDateKey(joinedOn)) throw new Error("Invalid joining date.")
  if (!isValidDateKey(referenceDate)) throw new Error("Invalid reference date.")
  if (referenceInstant !== undefined && !Number.isFinite(Date.parse(referenceInstant))) {
    throw new Error("Invalid attendance reference time.")
  }
  if (!isValidMonthKey(month)) throw new Error("Invalid attendance month.")
  assignments.forEach((assignment) => {
    if (!isValidDateKey(assignment.effectiveFrom)) throw new Error("Invalid assignment start date.")
    if (assignment.effectiveTo && !isValidDateKey(assignment.effectiveTo)) {
      throw new Error("Invalid assignment end date.")
    }
    if (assignment.effectiveTo && assignment.effectiveTo < assignment.effectiveFrom) {
      throw new Error("Assignment end date cannot precede its start date.")
    }
    if (!assignment.weekdays.length
      || new Set(assignment.weekdays).size !== assignment.weekdays.length
      || assignment.weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
      throw new Error("Invalid assignment weekdays.")
    }
  })
  occurrences.forEach((occurrence) => {
    if (!isValidDateKey(occurrence.occurrenceDate)) throw new Error("Invalid occurrence date.")
    if (!isValidDateKey(occurrence.eligibilityDate)) throw new Error("Invalid occurrence eligibility date.")
    if (referenceInstant !== undefined && typeof occurrence.startsAt !== "string") {
      throw new Error("Session start time is required for time-aware attendance.")
    }
  })
  if (adjustments.some((adjustment) => (
    !adjustment.id.trim() || !adjustment.sourceOccurrenceId.trim()
  ))) {
    throw new Error("Invalid attendance adjustment.")
  }
  if (new Set(adjustments.map((adjustment) => adjustment.id)).size !== adjustments.length
    || new Set(adjustments.map((adjustment) => adjustment.sourceOccurrenceId)).size !== adjustments.length) {
    throw new Error("Duplicate attendance adjustment.")
  }

  const eligibleOccurrences = occurrences.filter((occurrence) => (
    occurrence.status === "scheduled"
    && occurrence.occurrenceDate.startsWith(`${month}-`)
    && playerWasEnrolledForOccurrence(joinedOn, occurrence)
    && occurrence.occurrenceDate <= referenceDate
    && (referenceInstant === undefined || occurrenceHasStarted(
      { startsAt: occurrence.startsAt as string },
      referenceInstant,
    ))
    && assignments.some((assignment) => assignmentCoversOccurrence(assignment, occurrence))
  ))

  const recordByOccurrence = new Map(
    records.map((record) => [record.occurrenceId, record.choice]),
  )
  const adjustmentByOccurrence = new Map(
    adjustments.map((adjustment) => [adjustment.sourceOccurrenceId, adjustment.id]),
  )
  const appliedAdjustmentIds: string[] = []
  let attended = 0
  let absent = 0

  eligibleOccurrences.forEach((occurrence) => {
    const choice = recordByOccurrence.get(occurrence.id)
    if (choice === "present") attended += 1
    if (choice === "absent") {
      const adjustmentId = adjustmentByOccurrence.get(occurrence.id)
      if (adjustmentId) {
        attended += 1
        appliedAdjustmentIds.push(adjustmentId)
      } else {
        absent += 1
      }
    }
  })

  const recorded = attended + absent
  const breakdown: AttendanceBreakdown = {
    eligible: eligibleOccurrences.length,
    recorded,
    attended,
    absent,
    pending: eligibleOccurrences.length - recorded,
    percentage: recorded ? Math.round((attended / recorded) * 100) : null,
  }
  assertAttendanceBreakdown(breakdown)
  return {
    breakdown,
    appliedAdjustmentIds: appliedAdjustmentIds.sort((first, second) => first.localeCompare(second)),
  }
}

export function calculateMonthlyAttendance(input: MonthlyAttendanceInput): AttendanceBreakdown {
  return calculateMonthlyAttendanceResult(input).breakdown
}

export function createAttendanceSnapshotV2(
  input: MonthlyAttendanceInput,
): AttendanceSnapshotV2 {
  return {
    version: 2,
    source: "session-occurrences",
    month: input.month,
    referenceDate: input.referenceDate,
    ...calculateMonthlyAttendance(input),
  }
}

export function createAttendanceSnapshotV3(
  input: MonthlyAttendanceInput & { referenceInstant: string },
): AttendanceSnapshotV3 {
  if (!Number.isFinite(Date.parse(input.referenceInstant))) {
    throw new Error("Invalid attendance reference time.")
  }
  return {
    version: 3,
    source: "session-occurrences",
    month: input.month,
    referenceDate: input.referenceDate,
    referenceInstant: input.referenceInstant,
    ...calculateMonthlyAttendance(input),
  }
}

export function createAttendanceSnapshotV4(
  input: MonthlyAttendanceInput & { referenceInstant: string },
): AttendanceSnapshotV4 {
  if (!Number.isFinite(Date.parse(input.referenceInstant))) {
    throw new Error("Invalid attendance reference time.")
  }
  const result = calculateMonthlyAttendanceResult(input)
  return {
    version: 4,
    source: "session-occurrences",
    month: input.month,
    referenceDate: input.referenceDate,
    referenceInstant: input.referenceInstant,
    adjustmentPolicyVersion: 1,
    appliedAdjustmentIds: result.appliedAdjustmentIds,
    ...result.breakdown,
  }
}

export function parseAttendanceSnapshot(value: unknown): AttendanceSnapshot | null {
  if (!value || typeof value !== "object") return null
  const snapshot = value as Partial<AttendanceBreakdown> & {
    version?: number
    source?: unknown
    month?: unknown
    referenceDate?: unknown
    referenceInstant?: unknown
    adjustmentPolicyVersion?: unknown
    appliedAdjustmentIds?: unknown
  }
  if ((snapshot.version !== 1 && snapshot.version !== 2 && snapshot.version !== 3 && snapshot.version !== 4)
    || typeof snapshot.month !== "string"
    || !isValidMonthKey(snapshot.month)
    || typeof snapshot.referenceDate !== "string"
    || !isValidDateKey(snapshot.referenceDate)
    || typeof snapshot.eligible !== "number"
    || typeof snapshot.recorded !== "number"
    || typeof snapshot.attended !== "number"
    || typeof snapshot.absent !== "number"
    || typeof snapshot.pending !== "number"
    || (snapshot.percentage !== null && typeof snapshot.percentage !== "number")) {
    return null
  }

  if (snapshot.version === 2
    && (snapshot as Partial<AttendanceSnapshotV2>).source !== "session-occurrences") return null
  if (snapshot.version === 3 && (
    (snapshot as Partial<AttendanceSnapshotV3>).source !== "session-occurrences"
    || typeof snapshot.referenceInstant !== "string"
    || !Number.isFinite(Date.parse(snapshot.referenceInstant))
  )) return null
  if (snapshot.version === 4 && (
    (snapshot as Partial<AttendanceSnapshotV4>).source !== "session-occurrences"
    || typeof snapshot.referenceInstant !== "string"
    || !Number.isFinite(Date.parse(snapshot.referenceInstant))
    || snapshot.adjustmentPolicyVersion !== 1
    || !Array.isArray(snapshot.appliedAdjustmentIds)
    || snapshot.appliedAdjustmentIds.some((id) => typeof id !== "string" || !id.trim())
    || new Set(snapshot.appliedAdjustmentIds).size !== snapshot.appliedAdjustmentIds.length
  )) return null

  try {
    assertAttendanceBreakdown(snapshot as AttendanceBreakdown)
    return snapshot as AttendanceSnapshot
  } catch {
    return null
  }
}
