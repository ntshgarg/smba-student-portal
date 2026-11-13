import "server-only"

import { and, asc, eq, inArray, isNull } from "drizzle-orm"

import { formatAcademyId, identityNameParts } from "@/lib/auth/identity"
import { academyToday } from "@/lib/clock"
import { initializeDatabase } from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  authCredentialStates,
  coachProfiles,
  feeAgreements,
  playerEnrollments,
  sessionAssignments,
  sessionSeries,
} from "@/lib/db/schema"
import {
  derivePlayerOnboardingWorkspace,
  type PlayerOnboardingSummary,
  type PlayerOnboardingWorkspace,
} from "@/lib/coach/onboarding"
import { readOnboardingRecords } from "@/lib/coach/onboarding-service"
import type {
  AcademyMember,
  AcademyStaffMember,
  OperationalAcademyMember,
  PlayerTrainingProfile,
} from "@/lib/coach/types"
import {
  listSessionAssignments,
  listSessionOccurrences,
  listSessionSeries,
  sessionPortalWindow,
} from "@/lib/sessions/database"
import { loadOpenPlaces, type OpenPlace } from "@/lib/sessions/open-places"
import { playerTrainingStatus } from "@/lib/sessions/term"

type PlayerTrainingRow = Pick<
  typeof playerEnrollments.$inferSelect,
  | "academyPlan"
  | "ageGroup"
  | "batch"
  | "trainingStartOn"
  | "level"
  | "recordRevision"
  | "status"
> & { id: string }

function openPlacesByPlayer(accountIds?: readonly string[]) {
  return loadOpenPlaces(initializeDatabase(), accountIds)
}

function trainingProfilesFromRows(
  rows: PlayerTrainingRow[],
  openPlacesByAccount: Map<string, OpenPlace[]>,
  today: string,
): PlayerTrainingProfile[] {
  return rows.map((row) => {
    const openPlaces = openPlacesByAccount.get(row.id) ?? []
    // Every open place, a finished term's included: actions and archiving
    // read this as "still holds a place", whatever the schedule's dates.
    const activeSessionIds = openPlaces.map((place) => place.seriesId)
    const { status, termFinishedOn } = playerTrainingStatus({
      enrollmentStatus: row.status,
      openPlaces,
      today,
    })

    return {
      memberId: row.id,
      ageGroup: row.ageGroup ?? "Not recorded",
      level: row.level ?? "Assessment pending",
      batch: row.batch ?? "Assessment pending",
      academyPlan: row.academyPlan,
      activeSessionIds,
      recordRevision: row.recordRevision,
      status,
      termFinishedOn,
    }
  })
}

export function listOperationalPlayerRecords(
  accountIds?: readonly string[],
  today = academyToday(),
) {
  if (accountIds && !accountIds.length) {
    return { members: [], trainingProfiles: [] }
  }
  const db = initializeDatabase()
  const rows = db.select({
    id: accounts.id,
    fullName: accounts.fullName,
    trainingStartOn: playerEnrollments.trainingStartOn,
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
    trainingStartOn: row.trainingStartOn,
  }))

  return {
    members,
    trainingProfiles: trainingProfilesFromRows(rows, openPlacesByPlayer(accountIds), today),
  }
}

/**
 * Historical attendance keeps archived players visible without widening any
 * active roster, recorder, reporting, or onboarding projection.
 */
export function listAttendanceRegisterPlayerRecords(
  accountIds?: readonly string[],
  today = academyToday(),
) {
  if (accountIds && !accountIds.length) {
    return { members: [], trainingProfiles: [] }
  }
  const db = initializeDatabase()
  const rows = db.select({
    id: accounts.id,
    fullName: accounts.fullName,
    trainingStartOn: playerEnrollments.trainingStartOn,
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
    trainingStartOn: row.trainingStartOn,
  }))

  return {
    members,
    trainingProfiles: trainingProfilesFromRows(rows, openPlacesByPlayer(accountIds), today),
  }
}

/*
 * The coaching half of the Member Directory. It is a separate read rather than
 * a branch of `listApprovedPlayerRecords` because the player query hangs off an
 * inner join to `player_enrollments`, and a coach has no row there -- there is
 * no widening of that query that returns both, only a union of two.
 *
 * Head coach included alongside the juniors. "Coaching staff" that omits the
 * head coach would be a second directory with a second silent exclusion, which
 * is the thing this is fixing.
 */
export function listApprovedStaffRecords(): AcademyStaffMember[] {
  const db = initializeDatabase()
  const rows = db.select({
    accessLevel: coachProfiles.accessLevel,
    academyIdSerial: academyIdAllocations.serial,
    activatedAt: authCredentialStates.activatedAt,
    approvedAt: accounts.approvedAt,
    fullName: accounts.fullName,
    id: accounts.id,
    joinedOn: coachProfiles.joinedOn,
  })
    .from(accounts)
    .innerJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .leftJoin(authCredentialStates, eq(authCredentialStates.accountId, accounts.id))
    .where(and(
      eq(accounts.role, "coach"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .orderBy(asc(accounts.fullName))
    .all()

  return rows.map((row) => ({
    id: row.id,
    role: "coach" as const,
    accessLevel: row.accessLevel === "head_admin" ? "head_admin" as const : "junior_coach" as const,
    academyId: formatAcademyId(row.academyIdSerial),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    fullName: row.fullName,
    initials: identityNameParts(row.fullName).initials,
    joinedOn: row.joinedOn,
  }))
}

export function listApprovedPlayerRecords(today = academyToday()) {
  const db = initializeDatabase()
  const rows = db.select({
    activatedAt: authCredentialStates.activatedAt,
    approvedAt: accounts.approvedAt,
    id: accounts.id,
    fullName: accounts.fullName,
    academyIdSerial: academyIdAllocations.serial,
    trainingStartOn: playerEnrollments.trainingStartOn,
    ageGroup: playerEnrollments.ageGroup,
    level: playerEnrollments.level,
    batch: playerEnrollments.batch,
    academyPlan: playerEnrollments.academyPlan,
    status: playerEnrollments.status,
    recordRevision: playerEnrollments.recordRevision,
    contactName: playerEnrollments.primaryContactName,
    contactRelationship: playerEnrollments.primaryContactRelationship,
    contactPhone: playerEnrollments.primaryContactPhone,
    onboardingCompletedAt: playerEnrollments.onboardingCompletedAt,
    requestedAt: accounts.createdAt,
    trainingStartConfirmedAt: playerEnrollments.trainingStartConfirmedAt,
  })
    .from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .leftJoin(authCredentialStates, eq(authCredentialStates.accountId, accounts.id))
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
    activatedAt: row.activatedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    fullName: row.fullName,
    initials: identityNameParts(row.fullName).initials,
    onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
    requestedAt: row.requestedAt.toISOString(),
    trainingStartOn: row.trainingStartOn,
    trainingStartConfirmedAt: row.trainingStartConfirmedAt?.toISOString() ?? null,
    primaryContact: {
      name: row.contactName ?? "",
      relationship: row.contactRelationship ?? "",
      phone: row.contactPhone ?? "",
    },
  }))

  const trainingProfiles = trainingProfilesFromRows(rows, openPlacesByPlayer(), today)

  return { members, trainingProfiles }
}

export function getPlayerOnboardingSummary(
  referenceDate = academyToday(),
): PlayerOnboardingSummary {
  return getPlayerOnboardingWorkspace(referenceDate).summary
}

export function getPlayerOnboardingWorkspace(
  referenceDate = academyToday(),
): PlayerOnboardingWorkspace {
  const db = initializeDatabase()
  const pendingRequests = db.select({
    contactEmail: accounts.contactEmail,
    contactPhone: accounts.contactPhone,
    createdAt: accounts.createdAt,
    dateOfBirth: accounts.dateOfBirth,
    fullName: accounts.fullName,
    id: accounts.id,
    requestedRole: accounts.requestedRole,
  })
    .from(accounts)
    .where(and(
      inArray(accounts.requestedRole, ["player", "coach"]),
      eq(accounts.approvalStatus, "pending"),
      isNull(accounts.archivedAt),
    ))
    .orderBy(asc(accounts.createdAt))
    .all()
    .map((request) => ({
      ...request,
      createdAt: request.createdAt.toISOString(),
      requestedRole: request.requestedRole === "coach" ? "coach" as const : "player" as const,
    }))
  const players = db.select({
    activatedAt: authCredentialStates.activatedAt,
    academyPlan: playerEnrollments.academyPlan,
    academyIdSerial: academyIdAllocations.serial,
    approvedAt: accounts.approvedAt,
    // Read for the duplicate hint on the approval screen only. A returning
    // member registers under a new identity, so nothing else would notice.
    contactEmail: accounts.contactEmail,
    dateOfBirth: accounts.dateOfBirth,
    batch: playerEnrollments.batch,
    contactName: playerEnrollments.primaryContactName,
    contactPhone: playerEnrollments.primaryContactPhone,
    contactRelationship: playerEnrollments.primaryContactRelationship,
    fullName: accounts.fullName,
    id: accounts.id,
    onboardingCompletedAt: playerEnrollments.onboardingCompletedAt,
    requestedAt: accounts.createdAt,
    trainingStartOn: playerEnrollments.trainingStartOn,
    trainingStartConfirmedAt: playerEnrollments.trainingStartConfirmedAt,
    level: playerEnrollments.level,
    recordRevision: playerEnrollments.recordRevision,
  }).from(accounts)
    .innerJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .innerJoin(academyIdAllocations, eq(academyIdAllocations.accountId, accounts.id))
    .leftJoin(authCredentialStates, eq(authCredentialStates.accountId, accounts.id))
    .where(and(
      eq(accounts.role, "player"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .all()
    .map((player) => ({
      academyId: formatAcademyId(player.academyIdSerial),
      activatedAt: player.activatedAt?.toISOString() ?? null,
      academyPlan: player.academyPlan,
      approvedAt: player.approvedAt?.toISOString() ?? null,
      batch: player.batch,
      fullName: player.fullName,
      id: player.id,
      onboardingCompletedAt: player.onboardingCompletedAt?.toISOString() ?? null,
      requestedAt: player.requestedAt.toISOString(),
      trainingStartOn: player.trainingStartOn,
      trainingStartConfirmedAt: player.trainingStartConfirmedAt?.toISOString() ?? null,
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

  const unfinishedIds = players
    .filter((player) => !player.onboardingCompletedAt)
    .map(({ id }) => id)

  return derivePlayerOnboardingWorkspace({
    assignments,
    feePlans,
    pendingRequests,
    players,
    playersWithRecords: new Set(readOnboardingRecords(db, unfinishedIds).keys()),
    referenceDate,
  })
}

export function getCoachSessionSnapshot(referenceDate = academyToday()) {
  const window = sessionPortalWindow(referenceDate)
  return {
    sessionSeries: listSessionSeries(),
    sessionOccurrences: listSessionOccurrences(window.from, window.to),
    sessionAssignments: listSessionAssignments(),
  }
}

/** Whether an approved player has yet to finish Player onboarding. */
export function playerIsInOnboarding(playerId: string) {
  const row = initializeDatabase().select({
    onboardingCompletedAt: playerEnrollments.onboardingCompletedAt,
  }).from(playerEnrollments)
    .where(eq(playerEnrollments.accountId, playerId))
    .get()
  return Boolean(row && !row.onboardingCompletedAt)
}
