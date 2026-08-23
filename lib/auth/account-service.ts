import "server-only"

import { createHash, randomInt, randomUUID } from "node:crypto"

import { and, asc, eq, isNull } from "drizzle-orm"

import {
  ACADEMY_ID_SERIAL_RANGES,
  HEAD_COACH_ACADEMY_ID,
  formatAcademyId,
  normalizeAcademyId,
  normalizeFullName,
  normalizedNameKey,
  type AccountRole,
} from "@/lib/auth/identity"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { operationalActionError } from "@/lib/actions/operational-result"
import type { PendingRegistration } from "@/lib/coach/types"
import {
  initializeDatabase,
  type SmbaDatabase,
  type SmbaDatabaseExecutor,
} from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  authCredentialStates,
  authMethods,
  coachProfiles,
  playerEnrollments,
} from "@/lib/db/schema"
import {
  createActivationClaimToken,
  extendActivationClaim,
  saveActivationClaim,
} from "@/lib/auth/credential-service"
import { getAcademyDateKey } from "@/lib/format"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function registerAccount(fullName: string, requestedRole: AccountRole) {
  const db = initializeDatabase()
  const normalized = normalizeFullName(fullName)
  const now = new Date()
  const id = randomUUID()

  db.insert(accounts).values({
    id,
    fullName: normalized,
    normalizedName: normalizedNameKey(normalized),
    requestedRole,
    approvalStatus: "pending",
    createdAt: now,
    updatedAt: now,
  }).run()

  return id
}

export function registerPublicAccountRequest(
  input: {
    activationToken: string
    fullName: string
    requestKey: string
    requestedRole: AccountRole
  },
  {
    createId = randomUUID,
    database = initializeDatabase(),
    now = new Date(),
  }: {
    createId?: () => string
    database?: SmbaDatabase
    now?: Date
  } = {},
) {
  const fullName = normalizeFullName(input.fullName)
  const requestKey = input.requestKey.trim()
  if (input.requestedRole !== "player" && input.requestedRole !== "coach") {
    operationalActionError("INVALID_INPUT", "Choose a valid account type.", "requestedRole")
  }

  if (!UUID_PATTERN.test(requestKey)) {
    operationalActionError(
      "INVALID_INPUT",
      "Refresh the page before sending this registration request.",
      "registrationRequestKey",
    )
  }
  if (fullName.length < 2 || fullName.length > 80) {
    operationalActionError(
      "INVALID_INPUT",
      "Enter your full name.",
      "fullName",
    )
  }
  const requestFingerprint = createHash("sha256").update(JSON.stringify({
    fullName,
    requestedRole: input.requestedRole,
    version: 2,
  })).digest("hex")

  return database.transaction((tx) => {
    const existing = tx.select({
      id: accounts.id,
      requestFingerprint: accounts.registrationRequestFingerprint,
    }).from(accounts)
      .where(eq(accounts.registrationRequestKey, requestKey))
      .get()

    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        operationalActionError(
          "CONFLICT",
          "This registration request has changed. Refresh the page before trying again.",
          "registrationRequestKey",
        )
      }
      saveActivationClaim({
        accountId: existing.id,
        token: input.activationToken,
      }, { database: tx, now })
      return { accountId: existing.id, reused: true }
    }

    const accountId = createId()
    tx.insert(accounts).values({
      id: accountId,
      fullName,
      normalizedName: normalizedNameKey(fullName),
      registrationRequestFingerprint: requestFingerprint,
      registrationRequestKey: requestKey,
      requestedRole: input.requestedRole,
      approvalStatus: "pending",
      createdAt: now,
      updatedAt: now,
    }).run()

    saveActivationClaim({ accountId, token: input.activationToken }, { database: tx, now })

    return { accountId, reused: false }
  }, { behavior: "immediate" })
}

export function registerPublicPlayerRequest(input: {
  activationToken?: string
  fullName: string
  requestKey: string
}, options?: Parameters<typeof registerPublicAccountRequest>[1]) {
  return registerPublicAccountRequest({
    ...input,
    activationToken: input.activationToken ?? createActivationClaimToken(),
    requestedRole: "player",
  }, options)
}

export function findApprovedAccountByAcademyId(value: string) {
  const db = initializeDatabase()
  return db.select({
    accessLevel: coachProfiles.accessLevel,
    accountId: accounts.id,
    fullName: accounts.fullName,
    role: accounts.role,
    academyId: authMethods.identifier,
    credentialStatus: authCredentialStates.status,
  })
    .from(authMethods)
    .innerJoin(accounts, eq(authMethods.accountId, accounts.id))
    .leftJoin(authCredentialStates, eq(authCredentialStates.accountId, accounts.id))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(and(
      eq(authMethods.identifier, normalizeAcademyId(value)),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .get()
}

export function listPendingRegistrations(): PendingRegistration[] {
  const registrations = initializeDatabase().select({
    id: accounts.id,
    fullName: accounts.fullName,
    requestedRole: accounts.requestedRole,
    createdAt: accounts.createdAt,
  })
    .from(accounts)
    .where(and(eq(accounts.approvalStatus, "pending"), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.createdAt))
    .all()
  return registrations.flatMap((registration) => (
    registration.requestedRole === "player" || registration.requestedRole === "coach"
      ? [{
        id: registration.id,
        fullName: registration.fullName,
        requestedRole: registration.requestedRole,
        createdAt: registration.createdAt.toISOString(),
      }]
      : []
  ))
}

function assertApprovingCoach(coachAccountId: string) {
  requireHeadAdminAccess(coachAccountId)
}

export function allocateRandomAcademyId(input: {
  accountId: string
  chooseIndex?: (availableCount: number) => number
  database: SmbaDatabaseExecutor
  now: Date
  role?: "coach" | "player"
  rolePrefixed?: boolean
}) {
  const used = new Set(input.database.select({ serial: academyIdAllocations.serial })
    .from(academyIdAllocations).all().map((row) => row.serial))
  const range = input.rolePrefixed
    ? input.role === "coach"
      ? ACADEMY_ID_SERIAL_RANGES.juniorCoach
      : ACADEMY_ID_SERIAL_RANGES.player
    : ACADEMY_ID_SERIAL_RANGES.legacy
  const available: number[] = []
  for (let serial = range.first; serial <= range.last; serial += 1) {
    if (!used.has(serial)) available.push(serial)
  }
  if (!available.length) {
    operationalActionError("CONFLICT", "No Academy IDs are currently available.", "academyId")
  }
  const index = input.chooseIndex
    ? input.chooseIndex(available.length)
    : randomInt(available.length)
  if (!Number.isInteger(index) || index < 0 || index >= available.length) {
    throw new Error("Academy ID random selection returned an invalid index.")
  }
  const serial = available[index]
  input.database.insert(academyIdAllocations).values({
    accountId: input.accountId,
    createdAt: input.now,
    serial,
  }).run()
  return { academyId: formatAcademyId(serial), serial }
}

export function approveRegistration(
  registrationId: string,
  coachAccountId: string,
  options: {
    requestedRole?: AccountRole
    now?: Date
    createFinanceId?: () => string
    createFeeReference?: () => string
    chooseAcademyIdIndex?: (availableCount: number) => number
  } = {},
) {
  assertApprovingCoach(coachAccountId)
  const db = initializeDatabase()

  return db.transaction((tx) => {
    const registration = tx.select().from(accounts)
      .where(and(eq(accounts.id, registrationId), eq(accounts.approvalStatus, "pending")))
      .get()
    if (!registration) {
      operationalActionError(
        "NOT_FOUND",
        "This registration is no longer pending.",
        "registrationId",
      )
    }
    if (options.requestedRole && registration.requestedRole !== options.requestedRole) {
      operationalActionError(
        "CONFLICT",
        "This registration has a different account role.",
        "registrationId",
      )
    }
    if (registration.requestedRole !== "player" && registration.requestedRole !== "coach") {
      operationalActionError("CONFLICT", "This account cannot use academy onboarding.", "registrationId")
    }

    const now = options.now ?? new Date()
    const approvingAcademyId = tx.select({ identifier: authMethods.identifier })
      .from(authMethods)
      .where(and(
        eq(authMethods.accountId, coachAccountId),
        eq(authMethods.method, "academy_id"),
        isNull(authMethods.revokedAt),
      ))
      .get()?.identifier
    const { academyId } = allocateRandomAcademyId({
      accountId: registration.id,
      chooseIndex: options.chooseAcademyIdIndex,
      database: tx,
      now,
      role: registration.requestedRole,
      rolePrefixed: approvingAcademyId === HEAD_COACH_ACADEMY_ID,
    })

    tx.update(accounts).set({
      role: registration.requestedRole,
      approvalStatus: "approved",
      approvedAt: now,
      approvedByAccountId: coachAccountId,
      updatedAt: now,
    }).where(eq(accounts.id, registration.id)).run()

    tx.insert(authMethods).values({
      id: randomUUID(),
      accountId: registration.id,
      method: "academy_id",
      identifier: academyId,
      createdAt: now,
    }).run()

    tx.insert(authCredentialStates).values({
      accountId: registration.id,
      status: "pending",
      updatedAt: now,
    }).onConflictDoUpdate({
      target: authCredentialStates.accountId,
      set: { status: "pending", updatedAt: now },
    }).run()
    extendActivationClaim(registration.id, { database: tx, now })

    if (registration.requestedRole === "player") {
      tx.insert(playerEnrollments).values({
        accountId: registration.id,
        status: "unassigned",
        trainingStartOn: getAcademyDateKey(now),
        updatedAt: now,
      }).run()
    } else {
      tx.insert(coachProfiles).values({
        accountId: registration.id,
        accessLevel: "junior_coach",
        joinedOn: getAcademyDateKey(now),
        createdAt: now,
        updatedAt: now,
      }).run()
    }

    return {
      academyId,
      fullName: registration.fullName,
      role: registration.requestedRole,
    }
  })
}

export function rejectRegistration(registrationId: string, coachAccountId: string) {
  assertApprovingCoach(coachAccountId)
  const now = new Date()
  const result = initializeDatabase().update(accounts).set({
    approvalStatus: "rejected",
    rejectedAt: now,
    rejectedByAccountId: coachAccountId,
    updatedAt: now,
  }).where(and(eq(accounts.id, registrationId), eq(accounts.approvalStatus, "pending"))).run()

  if (!result.changes) {
    operationalActionError(
      "NOT_FOUND",
      "This registration is no longer pending.",
      "registrationId",
    )
  }
}
