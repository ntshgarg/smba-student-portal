import { eq } from "drizzle-orm"

import type { SmbaDatabase } from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  authMethods,
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

export function seedReferenceData(db: SmbaDatabase) {
  db.insert(batches).values(batchSeed.map((batch) => ({ ...batch, active: true })))
    .onConflictDoNothing()
    .run()
}

export function seedDatabase(db: SmbaDatabase) {
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

  if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") {
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

  seedReferenceData(db)
}
