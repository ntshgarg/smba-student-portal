import "server-only"

import { and, desc, eq, gt, isNull, notExists } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"

import { calculatePlayerAttendanceForMonth } from "@/lib/attendance/database"
import { getPlayerAttendanceRecord } from "@/lib/attendance/player-record"
import type { AttendanceBreakdown } from "@/lib/attendance/domain"
import { identityNameParts } from "@/lib/auth/identity"
import { initializeDatabase } from "@/lib/db/client"
import {
  accounts,
  authMethods,
  monthlyReports,
  playerEnrollments,
  reportPublications,
  sessionSeries,
} from "@/lib/db/schema"
import { coachMessage } from "@/lib/data/portal-content"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import type { PortalRepository } from "@/lib/data/portal-repository"
import {
  academyTimeInputValue,
  formatDateKey,
  formatSessionLabel,
  getAcademyMonthKey,
} from "@/lib/format"
import type {
  AttendanceSummary,
  LatestReportSummary,
  MonthlyReport,
  PlayerProfile,
  PlayerReportArchiveItem,
} from "@/lib/types"
import {
  listSessionAssignmentsForPlayers,
  listSessionOccurrencesForSeries,
} from "@/lib/sessions/database"
import { resolveNextAssignedOccurrence } from "@/lib/sessions/domain"
import { academyPlanSummary } from "@/lib/training/academy-plans"
import { resolvePublishedReportAttendance } from "@/lib/reports/published-report"

function indiaMonthKey() {
  return getAcademyMonthKey()
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
  referenceInstant = new Date(),
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
  const today = getIndiaDateKey()
  const year = Number(today.slice(0, 4))
  const now = new Date()
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

type PublishedReportRow = {
  id: string
  month: string
  publication: {
    attendanceSnapshot: string | null
    coachName: string
    publishedAt: Date
    reportText: string
  }
}

type PlayerReportArchiveRow = {
  id: string
  month: string
  publishedAt: Date
  reportText: string
}

function latestPublishedReportSummary(accountId: string): LatestReportSummary | null {
  const row = initializeDatabase().select({
    month: monthlyReports.month,
  }).from(monthlyReports)
    .innerJoin(reportPublications, eq(reportPublications.reportId, monthlyReports.id))
    .where(eq(monthlyReports.accountId, accountId))
    .orderBy(desc(monthlyReports.month))
    .limit(1)
    .get()

  return row
    ? { monthLabel: monthDetails(row.month).monthLabel }
    : null
}

function playerReportArchiveRows(accountId: string): PlayerReportArchiveRow[] {
  const db = initializeDatabase()
  const newerPublication = alias(reportPublications, "newer_player_report_publication")

  return db.select({
    id: monthlyReports.id,
    month: monthlyReports.month,
    publishedAt: reportPublications.publishedAt,
    reportText: reportPublications.reportText,
  }).from(monthlyReports)
    .innerJoin(reportPublications, eq(reportPublications.reportId, monthlyReports.id))
    .where(and(
      eq(monthlyReports.accountId, accountId),
      notExists(
        db.select({ id: newerPublication.id })
          .from(newerPublication)
          .where(and(
            eq(newerPublication.reportId, reportPublications.reportId),
            gt(newerPublication.revision, reportPublications.revision),
          )),
      ),
    ))
    .orderBy(desc(monthlyReports.month))
    .all()
}

function toPlayerReportArchiveItems(
  rows: PlayerReportArchiveRow[],
): PlayerReportArchiveItem[] {
  return rows.map((report) => ({
    id: report.id,
    month: report.month,
    monthLabel: monthDetails(report.month).monthLabel,
    publishedAt: report.publishedAt.toISOString(),
    reportText: report.reportText,
  }))
}

function publishedReportRows(accountId: string, reportId?: string): PublishedReportRow[] {
  const db = initializeDatabase()
  const newerPublication = alias(reportPublications, "newer_report_publication")
  const ownerConditions = [eq(monthlyReports.accountId, accountId)]
  if (reportId) ownerConditions.push(eq(monthlyReports.id, reportId))

  return db.select({
    id: monthlyReports.id,
    month: monthlyReports.month,
    publication: {
      attendanceSnapshot: reportPublications.attendanceSnapshot,
      coachName: accounts.fullName,
      publishedAt: reportPublications.publishedAt,
      reportText: reportPublications.reportText,
    },
  }).from(monthlyReports)
    .innerJoin(reportPublications, eq(reportPublications.reportId, monthlyReports.id))
    .innerJoin(accounts, eq(reportPublications.publishedByAccountId, accounts.id))
    .where(and(
      ...ownerConditions,
      notExists(
        db.select({ id: newerPublication.id })
          .from(newerPublication)
          .where(and(
            eq(newerPublication.reportId, reportPublications.reportId),
            gt(newerPublication.revision, reportPublications.revision),
          )),
      ),
    ))
    .orderBy(desc(monthlyReports.month))
    .all()
}

function toPublishedReports(accountId: string, rows: PublishedReportRow[]): MonthlyReport[] {
  return rows.map((report) => {
    const publication = report.publication
    const details = monthDetails(report.month)
    const attendance = resolvePublishedReportAttendance({
      attendanceSnapshot: publication.attendanceSnapshot,
      month: report.month,
      playerId: accountId,
      publishedAt: publication.publishedAt,
    })
    return {
      id: report.id,
      month: report.month,
      monthLabel: details.monthLabel,
      publishedAt: publication.publishedAt.toISOString(),
      coachName: publication.coachName,
      reportText: publication.reportText,
      attendance: {
        month: details.month,
        eligible: attendance.eligible,
        recorded: attendance.recorded,
        attended: attendance.attended,
        absent: attendance.absent,
        pending: attendance.pending,
        percentage: attendance.percentage,
      },
      development: [],
    } satisfies MonthlyReport
  })
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
      latestReport: latestPublishedReportSummary(playerId),
      attendance: attendance.eligible || attendance.recorded ? attendance : null,
      attendanceRecord,
      nextSession: nextPlayerSession(playerId),
      announcements: [],
    }
  }

  async getProgress() {
    return null
  }

  async listReports(playerId: string) {
    return toPlayerReportArchiveItems(playerReportArchiveRows(playerId))
  }

  async getReport(playerId: string, reportId: string) {
    const rows = publishedReportRows(playerId, reportId)
    return toPublishedReports(playerId, rows)[0] ?? null
  }
}
