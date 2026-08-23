import "server-only"

import { and, eq, isNull } from "drizzle-orm"

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

export function getCoachAccessProfile(
  accountId: string,
  options: CoachAccessOptions = {},
): CoachAccessProfile | null {
  const database = options.database ?? initializeDatabase()
  const row = database.select({
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
    throw new Error("Junior coach access is required.")
  }
  return { ...profile, accessLevel: "junior_coach" }
}
