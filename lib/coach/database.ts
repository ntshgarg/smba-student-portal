import "server-only"

import { and, asc, desc, eq, gt, inArray, isNull, notExists } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"

import { formatAcademyId, identityNameParts } from "@/lib/auth/identity"
import { initializeDatabase } from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  feeAgreements,
  monthlyReports,
  playerEnrollments,
  reportPublications,
  sessionAssignments,
  sessionSeries,
} from "@/lib/db/schema"
import {
  derivePlayerOnboardingWorkspace,
  type PlayerOnboardingSummary,
  type PlayerOnboardingWorkspace,
} from "@/lib/coach/onboarding"
import type {
  AcademyMember,
  CoachMonthlyReportRecord,
  OperationalAcademyMember,
  PlayerTrainingProfile,
} from "@/lib/coach/types"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import {
  listSessionAssignments,
  listSessionOccurrences,
  listSessionSeries,
  sessionPortalWindow,
} from "@/lib/sessions/database"

function dateKey(value: Date) {
  return getIndiaDateKey(value)
}

type PlayerTrainingRow = Pick<
  typeof playerEnrollments.$inferSelect,
  | "academyPlan"
  | "ageGroup"
  | "batch"
  | "joinedAt"
  | "level"
  | "recordRevision"
  | "status"
> & { id: string }

function activeSeriesByPlayer(accountIds?: readonly string[]) {
  if (accountIds && !accountIds.length) return new Map<string, string[]>()
  const db = initializeDatabase()
  const assignments = db.select({
    accountId: sessionAssignments.accountId,
    seriesId: sessionAssignments.seriesId,
  }).from(sessionAssignments)
    .where(and(
      isNull(sessionAssignments.effectiveTo),
      accountIds ? inArray(sessionAssignments.accountId, [...accountIds]) : undefined,
    ))
    .all()

  return assignments.reduce<Map<string, string[]>>((map, assignment) => {
    const current = map.get(assignment.accountId) ?? []
    current.push(assignment.seriesId)
    map.set(assignment.accountId, current)
    return map
  }, new Map())
}

function trainingProfilesFromRows(
  rows: PlayerTrainingRow[],
  activeSeriesByAccount: Map<string, string[]>,
): PlayerTrainingProfile[] {
  return rows.map((row) => {
    const activeSessionIds = activeSeriesByAccount.get(row.id) ?? []
    const status = activeSessionIds.length
      ? "active" as const
      : row.status === "unassigned" ? "unassigned" as const : "paused" as const

    return {
      memberId: row.id,
      ageGroup: row.ageGroup ?? "Not recorded",
      level: row.level ?? "Assessment pending",
      batch: row.batch ?? "Assessment pending",
      academyPlan: row.academyPlan,
      activeSessionIds,
      recordRevision: row.recordRevision,
      status,
    }
  })
}

export function listOperationalPlayerRecords(accountIds?: readonly string[]) {
  if (accountIds && !accountIds.length) {
    return { members: [], trainingProfiles: [] }
  }
  const db = initializeDatabase()
  const rows = db.select({
    id: accounts.id,
    fullName: accounts.fullName,
    joinedAt: playerEnrollments.joinedAt,
    ageGroup: playerEnrollments.ageGroup,
    level: playerEnrollments.level,
    batch: playerEnrollments.batch,
    academyPlan: playerEnrollments.academyPlan,
    status: playerEnrollments.status,
    recordRevision: playerEnrollments.recordRevision,
  })
    .from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .where(and(
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
      accountIds ? inArray(accounts.id, [...accountIds]) : undefined,
    ))
    .orderBy(asc(accounts.fullName))
    .all()

  const members: OperationalAcademyMember[] = rows.map((row) => ({
    id: row.id,
    role: "player",
    fullName: row.fullName,
    initials: identityNameParts(row.fullName).initials,
    joinedAt: dateKey(row.joinedAt),
  }))

  return {
    members,
    trainingProfiles: trainingProfilesFromRows(rows, activeSeriesByPlayer(accountIds)),
  }
}

/**
 * Historical attendance keeps archived players visible without widening any
 * active roster, recorder, reporting, or onboarding projection.
 */
export function listAttendanceRegisterPlayerRecords(accountIds?: readonly string[]) {
  if (accountIds && !accountIds.length) {
    return { members: [], trainingProfiles: [] }
  }
  const db = initializeDatabase()
  const rows = db.select({
    id: accounts.id,
    fullName: accounts.fullName,
    joinedAt: playerEnrollments.joinedAt,
    ageGroup: playerEnrollments.ageGroup,
    level: playerEnrollments.level,
    batch: playerEnrollments.batch,
    academyPlan: playerEnrollments.academyPlan,
    status: playerEnrollments.status,
    recordRevision: playerEnrollments.recordRevision,
  })
    .from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .where(and(
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      accountIds ? inArray(accounts.id, [...accountIds]) : undefined,
    ))
    .orderBy(asc(accounts.fullName))
    .all()

  const members: OperationalAcademyMember[] = rows.map((row) => ({
    id: row.id,
    role: "player",
    fullName: row.fullName,
    initials: identityNameParts(row.fullName).initials,
    joinedAt: dateKey(row.joinedAt),
  }))

  return {
    members,
    trainingProfiles: trainingProfilesFromRows(rows, activeSeriesByPlayer(accountIds)),
  }
}

export function listApprovedPlayerRecords() {
  const db = initializeDatabase()
  const rows = db.select({
    id: accounts.id,
    fullName: accounts.fullName,
    academyIdSerial: academyIdAllocations.serial,
    joinedAt: playerEnrollments.joinedAt,
    ageGroup: playerEnrollments.ageGroup,
    level: playerEnrollments.level,
    batch: playerEnrollments.batch,
    academyPlan: playerEnrollments.academyPlan,
    status: playerEnrollments.status,
    recordRevision: playerEnrollments.recordRevision,
    contactName: playerEnrollments.primaryContactName,
    contactRelationship: playerEnrollments.primaryContactRelationship,
    contactPhone: playerEnrollments.primaryContactPhone,
  })
    .from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .where(and(
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .orderBy(asc(accounts.fullName))
    .all()

  const members: AcademyMember[] = rows.map((row) => ({
    id: row.id,
    role: "player",
    academyId: formatAcademyId(row.academyIdSerial),
    fullName: row.fullName,
    initials: identityNameParts(row.fullName).initials,
    joinedAt: dateKey(row.joinedAt),
    primaryContact: {
      name: row.contactName ?? "",
      relationship: row.contactRelationship ?? "",
      phone: row.contactPhone ?? "",
    },
  }))

  const trainingProfiles = trainingProfilesFromRows(rows, activeSeriesByPlayer())

  return { members, trainingProfiles }
}

export function getPlayerOnboardingSummary(
  referenceDate = getIndiaDateKey(),
): PlayerOnboardingSummary {
  return getPlayerOnboardingWorkspace(referenceDate).summary
}

export function getPlayerOnboardingWorkspace(
  referenceDate = getIndiaDateKey(),
): PlayerOnboardingWorkspace {
  const db = initializeDatabase()
  const pendingRequests = db.select({
    createdAt: accounts.createdAt,
    fullName: accounts.fullName,
    id: accounts.id,
  })
    .from(accounts)
    .where(and(
      eq(accounts.requestedRole, "player"),
      eq(accounts.approvalStatus, "pending"),
      isNull(accounts.archivedAt),
    ))
    .orderBy(asc(accounts.createdAt))
    .all()
    .map((request) => ({
      ...request,
      createdAt: request.createdAt.toISOString(),
    }))
  const players = db.select({
    academyPlan: playerEnrollments.academyPlan,
    academyIdSerial: academyIdAllocations.serial,
    batch: playerEnrollments.batch,
    contactName: playerEnrollments.primaryContactName,
    contactPhone: playerEnrollments.primaryContactPhone,
    contactRelationship: playerEnrollments.primaryContactRelationship,
    fullName: accounts.fullName,
    id: accounts.id,
    joinedAt: playerEnrollments.joinedAt,
    level: playerEnrollments.level,
    recordRevision: playerEnrollments.recordRevision,
  }).from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .where(and(
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .all()
    .map((player) => ({
      academyId: formatAcademyId(player.academyIdSerial),
      academyPlan: player.academyPlan,
      batch: player.batch,
      fullName: player.fullName,
      id: player.id,
      joinedAt: dateKey(player.joinedAt),
      level: player.level,
      primaryContact: {
        name: player.contactName ?? "",
        phone: player.contactPhone ?? "",
        relationship: player.contactRelationship ?? "",
      },
      recordRevision: player.recordRevision,
    }))

  if (!players.length) {
    return derivePlayerOnboardingWorkspace({
      assignments: [],
      feePlans: [],
      pendingRequests,
      players: [],
      referenceDate,
    })
  }

  const playerIds = players.map(({ id }) => id)
  const assignments = db.select({
    batch: sessionSeries.batch,
    effectiveFrom: sessionAssignments.effectiveFrom,
    effectiveTo: sessionAssignments.effectiveTo,
    playerId: sessionAssignments.accountId,
    programme: sessionSeries.programme,
    seriesEndsOn: sessionSeries.endsOn,
    seriesStartsOn: sessionSeries.startsOn,
    seriesStatus: sessionSeries.status,
  }).from(sessionAssignments)
    .innerJoin(sessionSeries, eq(sessionSeries.id, sessionAssignments.seriesId))
    .where(inArray(sessionAssignments.accountId, playerIds))
    .all()
  const feePlans = db.select({
    academyPlan: feeAgreements.academyPlan,
    batch: feeAgreements.batch,
    effectiveFrom: feeAgreements.effectiveFrom,
    effectiveTo: feeAgreements.effectiveTo,
    level: feeAgreements.level,
    playerId: feeAgreements.playerAccountId,
  }).from(feeAgreements)
    .where(inArray(feeAgreements.playerAccountId, playerIds))
    .all()

  return derivePlayerOnboardingWorkspace({
    assignments,
    feePlans,
    pendingRequests,
    players,
    referenceDate,
  })
}

export function listCoachMonthlyReports(): CoachMonthlyReportRecord[] {
  const db = initializeDatabase()
  const newerPublication = alias(reportPublications, "newer_coach_report_publication")
  const reports = db.select({
    report: monthlyReports,
    publication: {
      publishedAt: reportPublications.publishedAt,
      reportText: reportPublications.reportText,
      revision: reportPublications.revision,
    },
  }).from(monthlyReports)
    .leftJoin(reportPublications, and(
      eq(reportPublications.reportId, monthlyReports.id),
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

  return reports.map(({ report, publication }) => {
    return {
      id: report.id,
      playerId: report.accountId,
      month: report.month,
      reportText: report.draftText,
      nextPriorities: "",
      updatedAt: report.updatedAt.toISOString(),
      published: publication
        ? {
            reportText: publication.reportText,
            nextPriorities: "",
            publishedAt: publication.publishedAt.toISOString(),
            updatedAt: publication.publishedAt.toISOString(),
            revision: publication.revision,
          }
        : null,
    }
  })
}

export function getCoachSessionSnapshot(referenceDate = getIndiaDateKey()) {
  const window = sessionPortalWindow(referenceDate)
  return {
    sessionSeries: listSessionSeries(),
    sessionOccurrences: listSessionOccurrences(window.from, window.to),
    sessionAssignments: listSessionAssignments(),
  }
}
