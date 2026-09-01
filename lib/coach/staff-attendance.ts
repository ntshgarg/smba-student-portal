import "server-only"

import { randomUUID } from "node:crypto"

import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm"

import { isValidDateKey } from "@/lib/attendance/domain"
import { operationalActionError } from "@/lib/actions/operational-result"
import {
  getCoachAccessProfile,
  requireHeadAdminAccess,
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
  expectedChoice: StaffAttendanceChoice
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

export type StaffAttendanceRegisterProfile = JuniorCoachProfile & {
  archivedOn: string | null
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

/**
 * Reads the requester's profile once and every requested coach's eligibility
 * once, instead of both per coach. Archived staff stay eligible here because the
 * head register has to keep their history — that is why this predicate set is
 * deliberately not `getCoachAccessProfile`'s, which excludes them.
 *
 * `coach_profiles.account_id` is a primary key and
 * `academy_id_allocations_account_idx` is unique, so both inner joins stay 1:1
 * and the read yields at most one row per account. Requested accounts are then
 * checked in request order, so the coach whose guard failed first still fails
 * first, with the same message.
 */
function requireAttendanceReadAccess({
  coachAccountIds,
  database,
  requesterAccountId,
}: {
  coachAccountIds: readonly string[]
  database: SmbaDatabaseExecutor
  requesterAccountId: string
}) {
  const requester = getCoachAccessProfile(requesterAccountId, { database })
  if (!requester) throw new Error("Coach access is required.")
  const eligible = new Set(database.select({ accountId: accounts.id })
    .from(coachProfiles)
    .innerJoin(accounts, eq(accounts.id, coachProfiles.accountId))
    .innerJoin(
      academyIdAllocations,
      eq(academyIdAllocations.accountId, accounts.id),
    )
    .where(and(
      inArray(accounts.id, [...new Set(coachAccountIds)]),
      eq(coachProfiles.accessLevel, "junior_coach"),
      eq(accounts.role, "coach"),
      eq(accounts.approvalStatus, "approved"),
    ))
    .all()
    .map((row) => row.accountId))
  coachAccountIds.forEach((coachAccountId) => {
    if (!eligible.has(coachAccountId)) {
      throw new Error("Assistant coach access is required.")
    }
    if (requester.accessLevel !== "head_admin" && requester.accountId !== coachAccountId) {
      throw new Error("Assistant coaches can only view their own attendance.")
    }
  })
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

/** Head-coach register projection that preserves archived staff history. */
export function listJuniorCoachAttendanceRegisterProfiles({
  database = initializeDatabase(),
  requesterAccountId,
}: {
  database?: SmbaDatabaseExecutor
  requesterAccountId: string
}): StaffAttendanceRegisterProfile[] {
  requireHeadAdminAccess(requesterAccountId, { database })
  return database.select({
    accountId: accounts.id,
    academyIdSerial: academyIdAllocations.serial,
    archivedAt: accounts.archivedAt,
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
    ))
    .orderBy(asc(accounts.fullName), asc(accounts.id))
    .all()
    .map((row) => {
      const { firstName, initials, normalizedName } = identityNameParts(row.fullName)
      return {
        accountId: row.accountId,
        academyId: formatAcademyId(row.academyIdSerial),
        archivedOn: row.archivedAt ? getIndiaDateKey(row.archivedAt) : null,
        fullName: normalizedName,
        firstName,
        initials,
        accessLevel: "junior_coach" as const,
        joinedOn: row.joinedOn,
      }
    })
}

/**
 * Reads a whole set of junior coaches' attendance in three queries instead of
 * three per coach. The map is keyed by coach account ID and pre-seeded in the
 * requested order, so a coach with no records in the range yields an empty array
 * rather than `undefined`.
 */
export function listStaffAttendanceRecordsByCoach({
  coachAccountIds,
  database = initializeDatabase(),
  from,
  requesterAccountId,
  to,
}: {
  coachAccountIds: readonly string[]
  database?: SmbaDatabaseExecutor
  from: string
  requesterAccountId: string
  to: string
}): Map<string, StaffAttendanceRecord[]> {
  assertDateRange(from, to)
  const grouped = new Map<string, StaffAttendanceRecord[]>(
    coachAccountIds.map((coachAccountId) => [coachAccountId, []]),
  )
  // Drizzle 0.45 renders `inArray(column, [])` as `false`, so an empty set would
  // be two round trips that can only return nothing.
  if (!grouped.size) return grouped
  requireAttendanceReadAccess({ coachAccountIds, database, requesterAccountId })
  database.select().from(staffAttendanceRecords)
    .where(and(
      inArray(staffAttendanceRecords.coachAccountId, [...grouped.keys()]),
      gte(staffAttendanceRecords.dateKey, from),
      lte(staffAttendanceRecords.dateKey, to),
    ))
    // `staff_attendance_coach_date_idx` is unique, so `dateKey` alone totally
    // orders one coach's rows and grouping cannot disturb them: every group
    // holds exactly the order a single-coach read produced.
    .orderBy(asc(staffAttendanceRecords.dateKey), asc(staffAttendanceRecords.id))
    .all()
    .forEach((record) => grouped.get(record.coachAccountId)?.push({
      id: record.id,
      coachAccountId: record.coachAccountId,
      dateKey: record.dateKey,
      choice: record.choice,
      markedByAccountId: record.markedByAccountId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }))
  return grouped
}

export function listStaffAttendanceRecords({
  coachAccountId,
  database = initializeDatabase(),
  from,
  requesterAccountId,
  to,
}: AttendanceReadInput): StaffAttendanceRecord[] {
  return listStaffAttendanceRecordsByCoach({
    coachAccountIds: [coachAccountId],
    database,
    from,
    requesterAccountId,
    to,
  }).get(coachAccountId) ?? []
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

function staffAttendanceCellKey(coachAccountId: string, dateKey: string) {
  return `${coachAccountId}:${dateKey}`
}

/**
 * `getCoachAccessProfile`'s predicate set, narrowed to junior coaches and
 * widened to a whole change set: one read for every coach instead of two per
 * change. Both inner joins are 1:1 (see `requireAttendanceReadAccess`), so the
 * read yields at most one row per account and an account absent from the map is
 * exactly the per-change `profile?.accessLevel !== "junior_coach"` rejection —
 * whether the profile was missing, archived, unapproved, not a coach, or a head
 * admin.
 */
function loadJuniorCoachSaveProfiles(
  database: SmbaDatabaseExecutor,
  coachAccountIds: readonly string[],
) {
  const profiles = new Map<string, { accountId: string; joinedOn: string }>()
  const ids = [...new Set(coachAccountIds)]
  if (!ids.length) return profiles
  database.select({
    accountId: accounts.id,
    joinedOn: coachProfiles.joinedOn,
  }).from(accounts)
    .innerJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    // Unread in the projection but load-bearing: `getCoachAccessProfile` returns
    // null for a coach with no academy ID allocation, so dropping this join
    // would let one through.
    .innerJoin(
      academyIdAllocations,
      eq(academyIdAllocations.accountId, accounts.id),
    )
    .where(and(
      inArray(accounts.id, ids),
      eq(coachProfiles.accessLevel, "junior_coach"),
      eq(accounts.role, "coach"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .all()
    .forEach((row) => profiles.set(row.accountId, row))
  return profiles
}

/**
 * Reads the stored choice behind a whole change set in one query instead of one
 * per change. `inArray` on both columns spans the coach × date cross product, so
 * the read can return cells the change set never mentions; only the exact pairs
 * are consumed. The map is pre-seeded with every change's cell, so a coach with
 * no record for a date reads as "cleared" — what the per-change
 * `stored?.choice ?? "cleared"` produced.
 */
function loadStoredStaffChoices(
  database: SmbaDatabaseExecutor,
  changes: readonly StaffAttendanceChange[],
) {
  const stored = new Map<string, StaffAttendanceChoice>(changes.map((change) => [
    staffAttendanceCellKey(change.coachAccountId, change.dateKey),
    "cleared",
  ]))
  if (!stored.size) return stored
  database.select({
    choice: staffAttendanceRecords.choice,
    coachAccountId: staffAttendanceRecords.coachAccountId,
    dateKey: staffAttendanceRecords.dateKey,
  }).from(staffAttendanceRecords)
    .where(and(
      inArray(
        staffAttendanceRecords.coachAccountId,
        [...new Set(changes.map((change) => change.coachAccountId))],
      ),
      inArray(
        staffAttendanceRecords.dateKey,
        [...new Set(changes.map((change) => change.dateKey))],
      ),
    ))
    .all()
    .forEach((row) => {
      const key = staffAttendanceCellKey(row.coachAccountId, row.dateKey)
      if (stored.has(key)) stored.set(key, row.choice)
    })
  return stored
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

  const applied = database.transaction((transaction) => {
    requireHeadAdminAccess(markedByAccountId, { database: transaction })
    const profiles = loadJuniorCoachSaveProfiles(
      transaction,
      changes.map((change) => change.coachAccountId),
    )
    const storedChoices = loadStoredStaffChoices(transaction, changes)
    // Every validation below stays in its original position, so the change that
    // failed first still fails first with the same code. Deferring the writes is
    // invisible: an error rolls the transaction back either way, and the
    // duplicate guard makes every (coach, date) cell distinct, so no change's
    // write could have altered another change's stored choice.
    const pending: (typeof staffAttendanceRecords.$inferInsert)[] = []
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
      if (change.expectedChoice !== "present"
        && change.expectedChoice !== "absent"
        && change.expectedChoice !== "cleared") {
        operationalActionError(
          "INVALID_INPUT",
          "Attendance is missing its original result. Refresh and try again.",
          "changes",
        )
      }

      const juniorCoach = profiles.get(change.coachAccountId)
      if (!juniorCoach) {
        operationalActionError(
          "NOT_FOUND",
          "The selected assistant coach is unavailable.",
          "changes",
        )
      }
      if (change.dateKey < juniorCoach.joinedOn) {
        operationalActionError(
          "BUSINESS_RULE",
          "Coach attendance cannot be marked before the joining date.",
          "changes",
        )
      }

      const currentChoice = storedChoices.get(
        staffAttendanceCellKey(juniorCoach.accountId, change.dateKey),
      ) ?? "cleared"
      if (currentChoice === change.choice) return
      if (currentChoice !== change.expectedChoice) {
        operationalActionError(
          "CONFLICT",
          "Staff attendance changed since this page was opened. Refresh and try again.",
          "changes",
        )
      }

      pending.push({
        id: randomUUID(),
        coachAccountId: juniorCoach.accountId,
        dateKey: change.dateKey,
        choice: change.choice,
        markedByAccountId,
        createdAt: now,
        updatedAt: now,
      })
    })

    if (pending.length) {
      transaction.insert(staffAttendanceRecords).values(pending).onConflictDoUpdate({
        target: [staffAttendanceRecords.coachAccountId, staffAttendanceRecords.dateKey],
        set: {
          // The only column that varies per row, so it has to come from the
          // conflicting row rather than a literal. `markedByAccountId` and
          // `updatedAt` are the same for the whole batch by construction, and
          // `createdAt` stays absent so an existing record keeps its original.
          choice: sql`excluded.${sql.raw(staffAttendanceRecords.choice.name)}`,
          markedByAccountId,
          updatedAt: now,
        },
      }).run()
    }
    return pending.length
  }, { behavior: "immediate" })

  return { applied }
}
