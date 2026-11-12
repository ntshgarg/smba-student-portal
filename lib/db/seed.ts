import { and, eq, ne } from "drizzle-orm"

import type { SmbaDatabase, SmbaDatabaseExecutor } from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  authMethods,
  authProviderAccounts,
  batches,
  coachProfiles,
} from "@/lib/db/schema"
import { getAcademyDateKey } from "@/lib/format"
import { provisionDevelopmentCredential } from "@/lib/auth/credential-service"

export const INITIAL_COACH_ACCOUNT_ID = "00000000-0000-4000-8000-000000000001"

const batchSeed = [
  { id: "weekday-beginner", schedule: "Weekday", programme: "Beginner" },
  { id: "weekday-intermediate", schedule: "Weekday", programme: "Intermediate" },
  { id: "weekday-advanced", schedule: "Weekday", programme: "Advanced" },
  { id: "weekday-adult", schedule: "Weekday", programme: "Adult" },
  { id: "weekend-beginner", schedule: "Weekend", programme: "Beginner" },
  { id: "weekend-intermediate", schedule: "Weekend", programme: "Intermediate" },
  { id: "weekend-advanced", schedule: "Weekend", programme: "Advanced" },
  { id: "weekend-adult", schedule: "Weekend", programme: "Adult" },
  // Weekday only: Elite trains five weekdays, so there is no weekend cohort.
  { id: "weekday-elite", schedule: "Weekday", programme: "Elite" },
] as const

export function seedReferenceData(db: SmbaDatabaseExecutor) {
  db.insert(batches).values(batchSeed.map((batch) => ({ ...batch, active: true })))
    .onConflictDoNothing()
    .run()
}

/**
 * The demo academy: the reference batches plus a ready-made head coach,
 * SMBA#0001, for local work and tests. One all-or-nothing step, so a failure
 * part-way never leaves half a coach behind.
 *
 * A database that already has its own head coach -- one created through the
 * one-time setup -- keeps that coach as the only one; the demo coach is not
 * added beside it. And a demo coach whose password was changed keeps the
 * changed password: the default is written only when there is none yet.
 */
export function seedDatabase(db: SmbaDatabase) {
  db.transaction((tx) => {
    const otherHeadCoach = tx.select({ accountId: coachProfiles.accountId })
      .from(coachProfiles)
      .where(and(
        eq(coachProfiles.accessLevel, "head_admin"),
        ne(coachProfiles.accountId, INITIAL_COACH_ACCOUNT_ID),
      ))
      .get()
    if (!otherHeadCoach) seedDemoHeadCoach(tx)
    seedReferenceData(tx)
  })
}

function seedDemoHeadCoach(db: SmbaDatabaseExecutor) {
  const now = new Date()

  db.insert(accounts).values({
    id: INITIAL_COACH_ACCOUNT_ID,
    fullName: "Sathiya Moorthy",
    normalizedName: "sathiya moorthy",
    requestedRole: "coach",
    role: "coach",
    approvalStatus: "approved",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().run()

  const existingAllocation = db.select().from(academyIdAllocations)
    .where(eq(academyIdAllocations.accountId, INITIAL_COACH_ACCOUNT_ID)).get()

  if (!existingAllocation) {
    db.insert(academyIdAllocations).values({
      serial: 1,
      accountId: INITIAL_COACH_ACCOUNT_ID,
      createdAt: now,
    }).run()
  }

  db.insert(authMethods).values({
    id: "00000000-0000-4000-8000-000000000002",
    accountId: INITIAL_COACH_ACCOUNT_ID,
    method: "academy_id",
    identifier: "SMBA#0001",
    createdAt: now,
  }).onConflictDoNothing().run()

  const existingPassword = db.select({ id: authProviderAccounts.id })
    .from(authProviderAccounts)
    .where(and(
      eq(authProviderAccounts.accountId, INITIAL_COACH_ACCOUNT_ID),
      eq(authProviderAccounts.providerId, "credential"),
    ))
    .get()
  if (!existingPassword && process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") {
    provisionDevelopmentCredential({
      academyId: "SMBA#0001",
      accountId: INITIAL_COACH_ACCOUNT_ID,
      fullName: "Sathiya Moorthy",
    }, { database: db, now })
  }

  const coachAccount = db.select({
    approvedAt: accounts.approvedAt,
    createdAt: accounts.createdAt,
  }).from(accounts).where(eq(accounts.id, INITIAL_COACH_ACCOUNT_ID)).get()

  db.insert(coachProfiles).values({
    accountId: INITIAL_COACH_ACCOUNT_ID,
    accessLevel: "head_admin",
    joinedOn: getAcademyDateKey(coachAccount?.approvedAt ?? coachAccount?.createdAt ?? now),
    createdAt: coachAccount?.approvedAt ?? coachAccount?.createdAt ?? now,
    updatedAt: now,
  }).onConflictDoNothing().run()
}
