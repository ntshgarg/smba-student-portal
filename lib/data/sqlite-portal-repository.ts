import "server-only"

import { and, desc, eq, isNull } from "drizzle-orm"

import { formatAssessmentDate } from "@/lib/assessments/display"
import { calculatePlayerAttendanceForMonth } from "@/lib/attendance/database"
import { getPlayerAttendanceRecord } from "@/lib/attendance/player-record"
import type { AttendanceBreakdown } from "@/lib/attendance/domain"
import { identityNameParts } from "@/lib/auth/identity"
import { initializeDatabase } from "@/lib/db/client"
import {
  accounts,
  authMethods,
  playerEnrollments,
  playerAssessments,
  sessionSeries,
} from "@/lib/db/schema"
import { academyCurrentMonth, academyNow, academyToday } from "@/lib/clock"
import { coachMessage } from "@/lib/data/portal-content"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import type { PortalRepository } from "@/lib/data/portal-repository"
import {
  academyTimeInputValue,
  formatDateKey,
  formatSessionLabel,
} from "@/lib/format"
import type {
  AttendanceSummary,
  LatestAssessmentSummary,
  PlayerProfile,
} from "@/lib/types"
import {
  listSessionAssignmentsForPlayers,
  listSessionOccurrencesForSeries,
} from "@/lib/sessions/database"
import { resolveNextAssignedOccurrence } from "@/lib/sessions/domain"
import { academyPlanSummary } from "@/lib/training/academy-plans"

function indiaMonthKey() {
  return academyCurrentMonth()
}

function monthDetails(month: string) {
  const dateKey = `${month}-01`
  return {
    month: formatDateKey(dateKey, {
      day: undefined,
      month: "long",
      weekday: undefined,
      year: undefined,
    }),
    monthLabel: formatDateKey(dateKey, {
      day: undefined,
      month: "long",
      weekday: undefined,
      year: "numeric",
    }),
  }
}

function emptyAttendance(): AttendanceBreakdown {
  return {
    eligible: 0,
    recorded: 0,
    attended: 0,
    absent: 0,
    pending: 0,
    percentage: null,
  }
}

function attendanceForMonth(
  accountId: string,
  month: string,
  referenceInstant = academyNow(),
  referenceDate = getIndiaDateKey(referenceInstant),
): AttendanceSummary {
  const attendance = calculatePlayerAttendanceForMonth(
    accountId,
    month,
    referenceDate,
    referenceInstant.toISOString(),
  )
    ?? emptyAttendance()
  const details = monthDetails(month)

  return {
    month: details.month,
    ...attendance,
  }
}

function findPlayer(accountId: string) {
  return initializeDatabase().select({
    id: accounts.id,
    fullName: accounts.fullName,
    academyId: authMethods.identifier,
    ageGroup: playerEnrollments.ageGroup,
    batch: playerEnrollments.batch,
    academyPlan: playerEnrollments.academyPlan,
    level: playerEnrollments.level,
    status: playerEnrollments.status,
    trainingStartOn: playerEnrollments.trainingStartOn,
  })
    .from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .innerJoin(authMethods, and(
      eq(authMethods.accountId, accounts.id),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
    ))
    .where(and(
      eq(accounts.id, accountId),
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    )).get()
}

function toPlayerProfile(accountId: string): PlayerProfile | null {
  const player = findPlayer(accountId)
  if (!player) return null
  const names = identityNameParts(player.fullName)

  return {
    id: player.id,
    fullName: player.fullName,
    firstName: names.firstName,
    initials: names.initials,
    ageGroup: player.ageGroup ?? "Not recorded",
    level: player.level ?? "Assessment pending",
    academyPlan: player.batch
      ? academyPlanSummary(player.batch, player.academyPlan)
      : "Assigned after assessment",
    memberSince: player.trainingStartOn,
    currentFocus: player.status === "unassigned" ? "First assessment" : "Current training block",
    status: player.status,
  }
}

function nextPlayerSession(accountId: string) {
  const db = initializeDatabase()
  const assignments = listSessionAssignmentsForPlayers([accountId])
  if (!assignments.length) return null
  const today = academyToday()
  const year = Number(today.slice(0, 4))
  const now = academyNow()
  // `resolveNextAssignedOccurrence` keeps only occurrences an assignment
  // covers, and `assignmentCoversOccurrence` requires the same `seriesId`
  // (`lib/sessions/domain.ts:274`), so every occurrence outside this player's
  // series was already being discarded after it crossed the network.
  const occurrence = resolveNextAssignedOccurrence({
    assignments,
    occurrences: listSessionOccurrencesForSeries(
      today,
      `${year + 1}-12-31`,
      [...new Set(assignments.map((assignment) => assignment.seriesId))],
    ),
    referenceInstant: now,
  })
  if (!occurrence) return null
  const series = db.select().from(sessionSeries).where(eq(sessionSeries.id, occurrence.seriesId)).get()
  if (!series) return null
  return {
    id: occurrence.id,
    startsAt: occurrence.startsAt,
    durationMinutes: occurrence.durationMinutes,
    title: formatSessionLabel({
      programme: series.programme,
      batch: series.batch,
      startTime: academyTimeInputValue(occurrence.startsAt),
      durationMinutes: occurrence.durationMinutes,
    }),
    trainingFocus: series.programme,
    batch: series.batch,
    venue: occurrence.venue,
    arrivalNote: "Arrive 15 minutes for a proper warm-up before the session.",
  }
}

function latestPublishedAssessmentSummary(accountId: string): LatestAssessmentSummary | null {
  const row = initializeDatabase().select({
    assessedOn: playerAssessments.assessedOn,
  }).from(playerAssessments)
    .where(and(
      eq(playerAssessments.playerAccountId, accountId),
      eq(playerAssessments.status, "published"),
    ))
    .orderBy(desc(playerAssessments.assessedOn))
    .limit(1)
    .get()

  return row ? { dateLabel: formatAssessmentDate(row.assessedOn) } : null
}

export class SqlitePortalRepository implements PortalRepository {
  async getPlayer(playerId: string) {
    return toPlayerProfile(playerId)
  }

  async getDashboard(playerId: string) {
    const player = toPlayerProfile(playerId)
    if (!player) return null
    const attendance = attendanceForMonth(playerId, indiaMonthKey())
    const attendanceRecord = getPlayerAttendanceRecord(playerId)
    if (!attendanceRecord) return null

    return {
      player,
      coachMessage,
      latestAssessment: latestPublishedAssessmentSummary(playerId),
      attendance: attendance.eligible || attendance.recorded ? attendance : null,
      attendanceRecord,
      nextSession: nextPlayerSession(playerId),
      announcements: [],
    }
  }

  async getProgress() {
    return null
  }
}
