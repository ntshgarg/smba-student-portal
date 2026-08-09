import "server-only"

import { randomUUID } from "node:crypto"

import { and, asc, eq, gte, isNull, lte } from "drizzle-orm"

import { isValidDateKey } from "@/lib/attendance/domain"
import { operationalActionError } from "@/lib/actions/operational-result"
import {
  getCoachAccessProfile,
  requireHeadAdminAccess,
  requireJuniorCoachAccess,
  type JuniorCoachProfile,
} from "@/lib/auth/coach-access"
import { formatAcademyId, identityNameParts } from "@/lib/auth/identity"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import {
  initializeDatabase,
  type SmbaDatabase,
  type SmbaDatabaseExecutor,
} from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  coachProfiles,
  staffAttendanceRecords,
} from "@/lib/db/schema"

export type StaffAttendanceChoice = "present" | "absent" | "cleared"

export type StaffAttendanceChange = {
  coachAccountId: string
  dateKey: string
  choice: StaffAttendanceChoice
}

export type StaffAttendanceRecord = {
  id: string
  coachAccountId: string
  dateKey: string
  choice: StaffAttendanceChoice
  markedByAccountId: string
  createdAt: string
  updatedAt: string
}

export type StaffAttendanceSummary = {
  coachAccountId: string
  from: string
  to: string
  present: number
  absent: number
  recorded: number
  percentage: number | null
}

type AttendanceReadInput = {
  requesterAccountId: string
  coachAccountId: string
  from: string
  to: string
  database?: SmbaDatabaseExecutor
}

function assertDateRange(from: string, to: string) {
  if (!isValidDateKey(from) || !isValidDateKey(to) || from > to) {
    throw new Error("Choose a valid attendance date range.")
  }
}

function requireAttendanceReadAccess({
  coachAccountId,
  database,
  requesterAccountId,
}: Pick<AttendanceReadInput, "coachAccountId" | "database" | "requesterAccountId">) {
  const requester = getCoachAccessProfile(requesterAccountId, { database })
  if (!requester) throw new Error("Coach access is required.")
  const juniorCoach = requireJuniorCoachAccess(coachAccountId, { database })
  if (requester.accessLevel !== "head_admin" && requester.accountId !== juniorCoach.accountId) {
    throw new Error("Junior coaches can only view their own attendance.")
  }
  return juniorCoach
}

export function listJuniorCoachProfiles({
  database = initializeDatabase(),
  requesterAccountId,
}: {
  database?: SmbaDatabaseExecutor
  requesterAccountId: string
}): JuniorCoachProfile[] {
  requireHeadAdminAccess(requesterAccountId, { database })
  return database.select({
    accountId: accounts.id,
    academyIdSerial: academyIdAllocations.serial,
    fullName: accounts.fullName,
    joinedOn: coachProfiles.joinedOn,
  }).from(coachProfiles)
    .innerJoin(accounts, eq(accounts.id, coachProfiles.accountId))
    .innerJoin(
      academyIdAllocations,
      eq(academyIdAllocations.accountId, accounts.id),
    )
    .where(and(
      eq(coachProfiles.accessLevel, "junior_coach"),
      eq(accounts.role, "coach"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .orderBy(asc(accounts.fullName), asc(accounts.id))
    .all()
    .map((row) => {
      const { firstName, initials, normalizedName } = identityNameParts(row.fullName)
      return {
        accountId: row.accountId,
        academyId: formatAcademyId(row.academyIdSerial),
        fullName: normalizedName,
        firstName,
        initials,
        accessLevel: "junior_coach" as const,
        joinedOn: row.joinedOn,
      }
    })
}

export function listStaffAttendanceRecords({
  coachAccountId,
  database = initializeDatabase(),
  from,
  requesterAccountId,
  to,
}: AttendanceReadInput): StaffAttendanceRecord[] {
  assertDateRange(from, to)
  requireAttendanceReadAccess({ coachAccountId, database, requesterAccountId })
  return database.select().from(staffAttendanceRecords)
    .where(and(
      eq(staffAttendanceRecords.coachAccountId, coachAccountId),
      gte(staffAttendanceRecords.dateKey, from),
      lte(staffAttendanceRecords.dateKey, to),
    ))
    .orderBy(asc(staffAttendanceRecords.dateKey), asc(staffAttendanceRecords.id))
    .all()
    .map((record) => ({
      id: record.id,
      coachAccountId: record.coachAccountId,
      dateKey: record.dateKey,
      choice: record.choice,
      markedByAccountId: record.markedByAccountId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }))
}

export function getStaffAttendanceSummary(
  input: AttendanceReadInput,
): StaffAttendanceSummary {
  const records = listStaffAttendanceRecords(input)
  const present = records.filter((record) => record.choice === "present").length
  const absent = records.filter((record) => record.choice === "absent").length
  const recorded = present + absent
  return {
    coachAccountId: input.coachAccountId,
    from: input.from,
    to: input.to,
    present,
    absent,
    recorded,
    percentage: recorded ? Math.round((present / recorded) * 100) : null,
  }
}

export function saveStaffAttendanceRecords({
  changes,
  database = initializeDatabase(),
  markedByAccountId,
  now = new Date(),
}: {
  changes: StaffAttendanceChange[]
  database?: SmbaDatabase
  markedByAccountId: string
  now?: Date
}) {
  if (Number.isNaN(now.getTime())) {
    operationalActionError(
      "INVALID_INPUT",
      "Choose a valid attendance date.",
      "changes",
    )
  }
  const referenceDate = getIndiaDateKey(now)
  const uniqueChanges = new Set<string>()

  database.transaction((transaction) => {
    requireHeadAdminAccess(markedByAccountId, { database: transaction })
    changes.forEach((change) => {
      const key = `${change.coachAccountId}:${change.dateKey}`
      if (uniqueChanges.has(key)) {
        operationalActionError(
          "INVALID_INPUT",
          "Attendance contains duplicate changes.",
          "changes",
        )
      }
      uniqueChanges.add(key)
      if (!isValidDateKey(change.dateKey)) {
        operationalActionError(
          "INVALID_INPUT",
          "Choose a valid attendance date.",
          "changes",
        )
      }
      if (change.dateKey > referenceDate) {
        operationalActionError(
          "BUSINESS_RULE",
          "Coach attendance cannot be marked for a future date.",
          "changes",
        )
      }
      if (change.choice !== "present"
        && change.choice !== "absent"
        && change.choice !== "cleared") {
        operationalActionError(
          "INVALID_INPUT",
          "Choose a valid attendance result.",
          "changes",
        )
      }

      const profile = getCoachAccessProfile(change.coachAccountId, {
        database: transaction,
      })
      if (profile?.accessLevel !== "junior_coach") {
        operationalActionError(
          "NOT_FOUND",
          "The selected junior coach is unavailable.",
          "changes",
        )
      }
      const juniorCoach = requireJuniorCoachAccess(change.coachAccountId, {
        database: transaction,
      })
      if (change.dateKey < juniorCoach.joinedOn) {
        operationalActionError(
          "BUSINESS_RULE",
          "Coach attendance cannot be marked before the joining date.",
          "changes",
        )
      }

      transaction.insert(staffAttendanceRecords).values({
        id: randomUUID(),
        coachAccountId: juniorCoach.accountId,
        dateKey: change.dateKey,
        choice: change.choice,
        markedByAccountId,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [staffAttendanceRecords.coachAccountId, staffAttendanceRecords.dateKey],
        set: {
          choice: change.choice,
          markedByAccountId,
          updatedAt: now,
        },
      }).run()
    })
  })

  return { applied: changes.length }
}
