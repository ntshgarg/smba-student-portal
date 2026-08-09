import "server-only"

import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm"

import { initializeDatabase } from "@/lib/db/client"
import {
  sessionAssignments,
  sessionAssignmentWeekdays,
  sessionAttendanceRecords,
  sessionOccurrences,
  sessionRecurrenceRules,
  sessionSeries,
} from "@/lib/db/schema"
import {
  compareSessionSeries,
  compareSessionSlots,
} from "@/lib/sessions/domain"
import { resolveOccurrenceEligibilityDates } from "@/lib/sessions/occurrence-lineage"
import type {
  SessionAssignment,
  SessionAttendanceRecords,
  TrainingSessionOccurrence,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

export function listSessionSeries(): TrainingSessionSeries[] {
  const db = initializeDatabase()
  const seriesRows = db.select().from(sessionSeries).orderBy(asc(sessionSeries.startsOn)).all()
  const rules = db.select().from(sessionRecurrenceRules)
    .orderBy(asc(sessionRecurrenceRules.weekday)).all()

  return seriesRows.map((series) => ({
    id: series.id,
    title: series.title,
    programme: series.programme,
    batch: series.batch,
    venue: series.venue,
    startsOn: series.startsOn,
    endsOn: series.endsOn,
    status: series.status,
    slots: rules.filter((rule) => rule.seriesId === series.id).map((rule) => ({
      id: rule.id,
      weekday: rule.weekday,
      startTime: rule.startTime,
      durationMinutes: rule.durationMinutes,
    })).sort(compareSessionSlots),
  })).sort(compareSessionSeries)
}

function occurrenceRecords(
  from: string,
  to: string,
  seriesIds?: readonly string[],
): TrainingSessionOccurrence[] {
  if (seriesIds && !seriesIds.length) return []
  const db = initializeDatabase()
  const occurrences = db.select().from(sessionOccurrences).where(and(
    gte(sessionOccurrences.occurrenceDate, from),
    lte(sessionOccurrences.occurrenceDate, to),
    seriesIds ? inArray(sessionOccurrences.seriesId, [...seriesIds]) : undefined,
  )).orderBy(asc(sessionOccurrences.startsAt), asc(sessionOccurrences.id)).all().map((occurrence) => ({
    id: occurrence.id,
    seriesId: occurrence.seriesId,
    occurrenceDate: occurrence.occurrenceDate,
    startsAt: occurrence.startsAt.toISOString(),
    durationMinutes: occurrence.durationMinutes,
    venue: occurrence.venue,
    status: occurrence.status,
    replacementForOccurrenceId: occurrence.replacementForOccurrenceId,
  }))
  return resolveOccurrenceEligibilityDates(db, occurrences)
}

export function listSessionOccurrences(from: string, to: string): TrainingSessionOccurrence[] {
  return occurrenceRecords(from, to)
}

export function listSessionOccurrencesForSeries(
  from: string,
  to: string,
  seriesIds: readonly string[],
): TrainingSessionOccurrence[] {
  return occurrenceRecords(from, to, seriesIds)
}

function assignmentRecords(seriesIds?: readonly string[]): SessionAssignment[] {
  if (seriesIds && !seriesIds.length) return []
  const database = initializeDatabase()
  const rows = seriesIds
    ? database.select().from(sessionAssignments)
        .where(inArray(sessionAssignments.seriesId, [...seriesIds]))
        .orderBy(asc(sessionAssignments.effectiveFrom), asc(sessionAssignments.id)).all()
    : database.select().from(sessionAssignments)
        .orderBy(asc(sessionAssignments.effectiveFrom), asc(sessionAssignments.id)).all()
  const assignmentIds = rows.map((assignment) => assignment.id)
  const weekdays = assignmentIds.length
    ? database.select().from(sessionAssignmentWeekdays)
        .where(inArray(sessionAssignmentWeekdays.assignmentId, assignmentIds))
        .orderBy(asc(sessionAssignmentWeekdays.weekday)).all()
    : []
  const weekdaysByAssignment = weekdays.reduce<Map<string, number[]>>((map, item) => {
    const current = map.get(item.assignmentId) ?? []
    current.push(item.weekday)
    map.set(item.assignmentId, current)
    return map
  }, new Map())

  return rows.map((assignment) => ({
    id: assignment.id,
    playerId: assignment.accountId,
    seriesId: assignment.seriesId,
    effectiveFrom: assignment.effectiveFrom,
    effectiveTo: assignment.effectiveTo,
    weekdays: weekdaysByAssignment.get(assignment.id) ?? [],
  }))
}

export function listSessionAssignments(): SessionAssignment[] {
  return assignmentRecords()
}

export function listSessionAssignmentsForSeries(
  seriesIds: readonly string[],
): SessionAssignment[] {
  return assignmentRecords(seriesIds)
}

function attendanceRecords(occurrenceIds?: readonly string[]): SessionAttendanceRecords {
  if (occurrenceIds && !occurrenceIds.length) return {}
  const database = initializeDatabase()
  const selection = {
    occurrenceId: sessionAttendanceRecords.occurrenceId,
    playerId: sessionAttendanceRecords.accountId,
    choice: sessionAttendanceRecords.choice,
  }
  const rows = occurrenceIds
    ? database.select(selection).from(sessionAttendanceRecords).where(and(
        inArray(sessionAttendanceRecords.occurrenceId, [...occurrenceIds]),
        ne(sessionAttendanceRecords.choice, "cleared"),
      )).all()
    : database.select(selection).from(sessionAttendanceRecords)
        .where(ne(sessionAttendanceRecords.choice, "cleared")).all()

  return rows.reduce<SessionAttendanceRecords>((records, row) => {
    if (row.choice === "cleared") return records
    records[row.occurrenceId] ??= {}
    records[row.occurrenceId][row.playerId] = row.choice
    return records
  }, {})
}

export function listSessionAttendanceRecords(): SessionAttendanceRecords {
  return attendanceRecords()
}

export function listSessionAttendanceRecordsForOccurrences(
  occurrenceIds: readonly string[],
): SessionAttendanceRecords {
  return attendanceRecords(occurrenceIds)
}

export function sessionPortalWindow(referenceDate: string) {
  const year = Number(referenceDate.slice(0, 4))
  return { from: `${year - 1}-01-01`, to: `${year + 1}-12-31` }
}

export function findScheduledOccurrence(occurrenceId: string) {
  return initializeDatabase().select().from(sessionOccurrences)
    .where(eq(sessionOccurrences.id, occurrenceId)).get()
}
