import "server-only"

import { and, asc, desc, eq } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"

import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { formatAcademyId } from "@/lib/auth/identity"
import {
  initializeDatabase,
  type SmbaDatabaseExecutor,
} from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  monthlyReports,
  reportPublications,
} from "@/lib/db/schema"
import { formatReportMonth } from "@/lib/coach/report-utils"
import { resolvePublishedReportAttendance } from "@/lib/reports/published-report"
import type { AttendanceSummary, MonthlyReport } from "@/lib/types"

export type CoachPublishedReportSummary = {
  reportId: string
  playerId: string
  playerName: string
  academyId: string
  playerArchived: boolean
  month: string
  latestPublicationId: string
  latestRevision: number
  revisionCount: number
  latestPublishedAt: string
}

export type CoachPublishedReportRevision = {
  publicationId: string
  revision: number
  publishedAt: string
  publishedByAccountId: string
  publishedByName: string
}

export type CoachPublishedReportDetail = {
  publicationId: string
  reportId: string
  playerId: string
  playerName: string
  academyId: string
  playerArchived: boolean
  month: string
  monthLabel: string
  revision: number
  reportText: string
  attendance: AttendanceSummary
  publishedAt: string
  publishedByAccountId: string
  publishedByName: string
  revisions: CoachPublishedReportRevision[]
}

type ArchiveOptions = {
  database?: SmbaDatabaseExecutor
}

type SummaryOptions = ArchiveOptions & {
  period: string
  query?: string
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u

function requireArchiveAccess(coachId: string, options: ArchiveOptions) {
  const database = options.database ?? initializeDatabase()
  requireHeadAdminAccess(coachId, { database })
  return database
}

function normalizedSearch(value: string | undefined) {
  return value?.trim().toLocaleLowerCase("en-IN") ?? ""
}

function matchesSearch(
  row: Pick<CoachPublishedReportSummary, "academyId" | "playerName">,
  query: string,
) {
  if (!query) return true
  return row.playerName.toLocaleLowerCase("en-IN").includes(query)
    || row.academyId.toLocaleLowerCase("en-IN").includes(query)
}

export function listCoachPublishedReportPeriods(
  coachId: string,
  options: ArchiveOptions = {},
) {
  const database = requireArchiveAccess(coachId, options)
  return database.selectDistinct({ month: monthlyReports.month })
    .from(monthlyReports)
    .innerJoin(reportPublications, eq(reportPublications.reportId, monthlyReports.id))
    .orderBy(desc(monthlyReports.month))
    .all()
    .map((row) => row.month)
}

export function listCoachPublishedReportSummaries(
  coachId: string,
  options: SummaryOptions,
): CoachPublishedReportSummary[] {
  const database = requireArchiveAccess(coachId, options)
  if (!MONTH_PATTERN.test(options.period)) return []

  const rows = database.select({
    reportId: monthlyReports.id,
    playerId: accounts.id,
    playerName: accounts.fullName,
    academyIdSerial: academyIdAllocations.serial,
    playerArchivedAt: accounts.archivedAt,
    month: monthlyReports.month,
    publicationId: reportPublications.id,
    revision: reportPublications.revision,
    publishedAt: reportPublications.publishedAt,
  }).from(monthlyReports)
    .innerJoin(reportPublications, eq(reportPublications.reportId, monthlyReports.id))
    .innerJoin(accounts, eq(accounts.id, monthlyReports.accountId))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .where(and(
      eq(monthlyReports.month, options.period),
      eq(accounts.role, "player"),
    ))
    .orderBy(
      asc(accounts.normalizedName),
      asc(academyIdAllocations.serial),
      desc(reportPublications.revision),
    )
    .all()

  const grouped = new Map<string, typeof rows>()
  rows.forEach((row) => grouped.set(row.reportId, [
    ...(grouped.get(row.reportId) ?? []),
    row,
  ]))
  const query = normalizedSearch(options.query)

  return [...grouped.values()].flatMap((revisions) => {
    const latest = revisions.reduce((current, candidate) => (
      candidate.revision > current.revision ? candidate : current
    ))
    const summary: CoachPublishedReportSummary = {
      reportId: latest.reportId,
      playerId: latest.playerId,
      playerName: latest.playerName,
      academyId: formatAcademyId(latest.academyIdSerial),
      playerArchived: latest.playerArchivedAt !== null,
      month: latest.month,
      latestPublicationId: latest.publicationId,
      latestRevision: latest.revision,
      revisionCount: revisions.length,
      latestPublishedAt: latest.publishedAt.toISOString(),
    }
    return matchesSearch(summary, query) ? [summary] : []
  })
}

export function getCoachPublishedReportDetail(
  coachId: string,
  publicationId: string,
  options: ArchiveOptions = {},
): CoachPublishedReportDetail | null {
  const database = requireArchiveAccess(coachId, options)
  if (!publicationId.trim()) return null
  const publisherAccounts = alias(accounts, "coach_report_publisher")

  const publication = database.select({
    publicationId: reportPublications.id,
    reportId: monthlyReports.id,
    playerId: accounts.id,
    playerName: accounts.fullName,
    academyIdSerial: academyIdAllocations.serial,
    playerArchivedAt: accounts.archivedAt,
    month: monthlyReports.month,
    revision: reportPublications.revision,
    reportText: reportPublications.reportText,
    attendanceSnapshot: reportPublications.attendanceSnapshot,
    publishedAt: reportPublications.publishedAt,
    publishedByAccountId: reportPublications.publishedByAccountId,
    publishedByName: publisherAccounts.fullName,
  }).from(reportPublications)
    .innerJoin(monthlyReports, eq(monthlyReports.id, reportPublications.reportId))
    .innerJoin(accounts, eq(accounts.id, monthlyReports.accountId))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .innerJoin(
      publisherAccounts,
      eq(publisherAccounts.id, reportPublications.publishedByAccountId),
    )
    .where(and(
      eq(reportPublications.id, publicationId),
      eq(accounts.role, "player"),
    ))
    .get()
  if (!publication) return null

  const revisionRows = database.select({
    publicationId: reportPublications.id,
    revision: reportPublications.revision,
    publishedAt: reportPublications.publishedAt,
    publishedByAccountId: reportPublications.publishedByAccountId,
    publishedByName: publisherAccounts.fullName,
  }).from(reportPublications)
    .innerJoin(
      publisherAccounts,
      eq(publisherAccounts.id, reportPublications.publishedByAccountId),
    )
    .where(eq(reportPublications.reportId, publication.reportId))
    .orderBy(desc(reportPublications.revision))
    .all()
  const attendance = resolvePublishedReportAttendance({
    attendanceSnapshot: publication.attendanceSnapshot,
    database,
    month: publication.month,
    playerId: publication.playerId,
    publishedAt: publication.publishedAt,
  })

  return {
    publicationId: publication.publicationId,
    reportId: publication.reportId,
    playerId: publication.playerId,
    playerName: publication.playerName,
    academyId: formatAcademyId(publication.academyIdSerial),
    playerArchived: publication.playerArchivedAt !== null,
    month: publication.month,
    monthLabel: formatReportMonth(publication.month),
    revision: publication.revision,
    reportText: publication.reportText,
    attendance: {
      month: formatReportMonth(publication.month),
      ...attendance,
    },
    publishedAt: publication.publishedAt.toISOString(),
    publishedByAccountId: publication.publishedByAccountId,
    publishedByName: publication.publishedByName,
    revisions: revisionRows.map((revision) => ({
      publicationId: revision.publicationId,
      revision: revision.revision,
      publishedAt: revision.publishedAt.toISOString(),
      publishedByAccountId: revision.publishedByAccountId,
      publishedByName: revision.publishedByName,
    })),
  }
}

export function coachPublishedReportAsMonthlyReport(
  report: CoachPublishedReportDetail,
): MonthlyReport {
  return {
    id: report.reportId,
    month: report.month,
    monthLabel: report.monthLabel,
    publishedAt: report.publishedAt,
    coachName: report.publishedByName,
    reportText: report.reportText,
    attendance: report.attendance,
    development: [],
  }
}
