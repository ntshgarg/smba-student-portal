import "server-only"

import { and, eq, isNull } from "drizzle-orm"
import { cache } from "react"

import { formatAcademyId, identityNameParts } from "@/lib/auth/identity"
import {
  initializeDatabase,
  type SmbaDatabaseExecutor,
} from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  coachProfiles,
} from "@/lib/db/schema"

export type CoachAccessLevel = "head_admin" | "junior_coach"

export type CoachAccessProfile = {
  accountId: string
  academyId: string
  fullName: string
  firstName: string
  initials: string
  accessLevel: CoachAccessLevel
  joinedOn: string
}

export type JuniorCoachProfile = CoachAccessProfile & {
  accessLevel: "junior_coach"
}

type CoachAccessOptions = {
  database?: SmbaDatabaseExecutor
}

/*
 * One /coach render asked this question three times: CoachLayout via
 * requireCoachPage, then CoachDashboardPage twice more because
 * getCoachFinanceDashboardSummary and countActiveCoachAnnouncements each
 * re-authorise through requireHeadAdminAccess. `lib/auth/current-coach.ts`
 * memoises its own wrapper, but a data-layer helper that checks its caller's
 * access does not go through that wrapper and never could.
 *
 * Measured on the demo fixture, lookups per render before this: /coach 3,
 * /coach/financials/records 3, /coach/announcements 3, /coach/financials/record 2.
 * All are 1 now.
 *
 * Locally that was free -- the database is a file. In production it is Turso over
 * the network, so each duplicate was a separate round trip out of bom1 for a row
 * the request was already holding. Memoising the read itself rather than one
 * wrapper is what makes the saving reach callers that re-authorise, which is
 * every caller that was paying for it.
 *
 * Safe to hold for the length of a request because nothing a request does can
 * change the answer for the account it is asking about. The only writers to
 * coach_profiles are initial-setup, where no prior profile exists, and
 * approveRegistration, which writes the *approved* account while the account
 * being looked up is the head coach approving them -- a different cache key.
 * member-service renames only players, and this query requires role = 'coach'.
 */
function selectCoachAccessRow(database: SmbaDatabaseExecutor, accountId: string) {
  return database.select({
    accountId: accounts.id,
    academyIdSerial: academyIdAllocations.serial,
    fullName: accounts.fullName,
    accessLevel: coachProfiles.accessLevel,
    joinedOn: coachProfiles.joinedOn,
  }).from(accounts)
    .innerJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .innerJoin(
      academyIdAllocations,
      eq(academyIdAllocations.accountId, accounts.id),
    )
    .where(and(
      eq(accounts.id, accountId),
      eq(accounts.role, "coach"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .get()
}

// Only the un-scoped read is memoised. A caller-supplied executor may be an open
// transaction, whose uncommitted rows must not outlive it or leak into a reader
// that asked the committed database the same question.
const readCoachAccessRow = cache(
  (accountId: string) => selectCoachAccessRow(initializeDatabase(), accountId),
)

export function getCoachAccessProfile(
  accountId: string,
  options: CoachAccessOptions = {},
): CoachAccessProfile | null {
  const row = options.database
    ? selectCoachAccessRow(options.database, accountId)
    : readCoachAccessRow(accountId)

  if (!row) return null
  const { firstName, initials, normalizedName } = identityNameParts(row.fullName)
  return {
    accountId: row.accountId,
    academyId: formatAcademyId(row.academyIdSerial),
    fullName: normalizedName,
    firstName,
    initials,
    accessLevel: row.accessLevel,
    joinedOn: row.joinedOn,
  }
}

function requireCoachAccessProfile(
  accountId: string,
  options: CoachAccessOptions = {},
) {
  const profile = getCoachAccessProfile(accountId, options)
  if (!profile) throw new Error("Coach access is required.")
  return profile
}

export function requireHeadAdminAccess(
  accountId: string,
  options: CoachAccessOptions = {},
) {
  const profile = requireCoachAccessProfile(accountId, options)
  if (profile.accessLevel !== "head_admin") {
    throw new Error("Head coach access is required.")
  }
  return profile
}

export function requireJuniorCoachAccess(
  accountId: string,
  options: CoachAccessOptions = {},
): JuniorCoachProfile {
  const profile = requireCoachAccessProfile(accountId, options)
  if (profile.accessLevel !== "junior_coach") {
    throw new Error("Assistant coach access is required.")
  }
  return { ...profile, accessLevel: "junior_coach" }
}
