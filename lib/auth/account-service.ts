import "server-only"

import { createHash, randomUUID } from "node:crypto"

import { and, asc, eq, isNull } from "drizzle-orm"

import {
  formatAcademyId,
  normalizeAcademyId,
  normalizeFullName,
  normalizedNameKey,
  type AccountRole,
} from "@/lib/auth/identity"
import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { operationalActionError } from "@/lib/actions/operational-result"
import type { PendingRegistration } from "@/lib/coach/types"
import { initializeDatabase, type SmbaDatabase } from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  authMethods,
  playerEnrollments,
} from "@/lib/db/schema"
import { issueRegistrationChargeForApprovedPlayer } from "@/lib/finance/service"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function prototypeAcademyIdAuthEnabled() {
  return process.env.PROTOTYPE_ACADEMY_ID_AUTH === "true"
}

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

export function registerPublicPlayerRequest(
  input: {
    fullName: string
    requestKey: string
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
    requestedRole: "player",
    version: 1,
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
      return { accountId: existing.id, reused: true }
    }

    const accountId = createId()
    tx.insert(accounts).values({
      id: accountId,
      fullName,
      normalizedName: normalizedNameKey(fullName),
      registrationRequestFingerprint: requestFingerprint,
      registrationRequestKey: requestKey,
      requestedRole: "player",
      approvalStatus: "pending",
      createdAt: now,
      updatedAt: now,
    }).run()

    return { accountId, reused: false }
  }, { behavior: "immediate" })
}

export function findApprovedAccountByAcademyId(value: string) {
  const db = initializeDatabase()
  return db.select({
    accountId: accounts.id,
    fullName: accounts.fullName,
    role: accounts.role,
    academyId: authMethods.identifier,
  })
    .from(authMethods)
    .innerJoin(accounts, eq(authMethods.accountId, accounts.id))
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
  return initializeDatabase().select({
    id: accounts.id,
    fullName: accounts.fullName,
    requestedRole: accounts.requestedRole,
    createdAt: accounts.createdAt,
  })
    .from(accounts)
    .where(and(eq(accounts.approvalStatus, "pending"), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.createdAt))
    .all()
    .map((registration) => ({
      ...registration,
      createdAt: registration.createdAt.toISOString(),
    }))
}

function assertApprovingCoach(coachAccountId: string) {
  requireHeadAdminAccess(coachAccountId)
}

export function approveRegistration(
  registrationId: string,
  coachAccountId: string,
  options: {
    requestedRole?: AccountRole
    now?: Date
    createFinanceId?: () => string
    createFeeReference?: () => string
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
      if (registration.requestedRole === "coach") {
        operationalActionError(
          "BUSINESS_RULE",
          "Coach accounts require controlled provisioning. Reject this public request.",
          "registrationId",
        )
      }
      operationalActionError(
        "CONFLICT",
        "This registration has a different account role.",
        "registrationId",
      )
    }

    const now = options.now ?? new Date()
    const allocation = tx.insert(academyIdAllocations).values({
      accountId: registration.id,
      createdAt: now,
    }).returning({ serial: academyIdAllocations.serial }).get()
    const academyId = formatAcademyId(allocation.serial)

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

    if (registration.requestedRole === "player") {
      tx.insert(playerEnrollments).values({
        accountId: registration.id,
        status: "unassigned",
        joinedAt: now,
        updatedAt: now,
      }).run()
      issueRegistrationChargeForApprovedPlayer({
        approvedAt: now,
        coachId: coachAccountId,
        createFeeReference: options.createFeeReference,
        createId: options.createFinanceId,
        database: tx,
        playerId: registration.id,
      })
    }

    return { academyId, fullName: registration.fullName, role: registration.requestedRole }
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
