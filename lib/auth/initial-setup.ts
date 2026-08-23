import "server-only"

import { createHash, randomBytes, randomUUID } from "node:crypto"

import { and, eq, gt, isNull } from "drizzle-orm"
import { hashPassword } from "better-auth/crypto"

import {
  ACADEMY_ID_SERIAL_RANGES,
  HEAD_COACH_ACADEMY_ID,
  normalizeFullName,
  normalizedNameKey,
  PLATFORM_ADMIN_ACADEMY_ID,
} from "@/lib/auth/identity"
import {
  PLATFORM_ADMIN_ACCOUNT_ID,
  upsertPasswordCredential,
  validateNewPassword,
  validatePin,
} from "@/lib/auth/credential-service"
import { consumeVerifiedSetupRecoveryEmail } from "@/lib/auth/recovery-service"
import { writeAuthSecurityEvent } from "@/lib/auth/security-context"
import {
  initializeDatabase,
  type SmbaDatabase,
  type SmbaDatabaseExecutor,
} from "@/lib/db/client"
import {
  academyIdAllocations,
  accounts,
  authMethods,
  authPinCredentials,
  authSetupClaims,
  coachProfiles,
} from "@/lib/db/schema"
import { getAcademyDateKey } from "@/lib/format"

export const HEAD_COACH_SETUP_COOKIE = "smba_head_coach_setup"
export const HEAD_COACH_SETUP_CLAIM_LIFETIME_MS = 60 * 60 * 1_000

function setupClaimHash(token: string) {
  return createHash("sha256").update(`head-coach-setup:${token.trim()}`).digest("hex")
}

export function createHeadCoachSetupClaim(input: {
  createdByAccountId: string
  claimImmediately?: boolean
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(now.getTime() + HEAD_COACH_SETUP_CLAIM_LIFETIME_MS)
  return database.transaction((tx) => {
    const owner = tx.select({ id: accounts.id }).from(accounts).where(and(
      eq(accounts.id, input.createdByAccountId),
      eq(accounts.role, "platform_admin"),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    )).get()
    if (!owner) throw new Error("Platform-owner access is required.")
    if (!headCoachSetupAvailable({ database: tx })) {
      throw new Error("The head-coach account has already been configured.")
    }
    tx.update(authSetupClaims).set({ consumedAt: now, updatedAt: now }).where(and(
      eq(authSetupClaims.purpose, "head_coach_setup"),
      isNull(authSetupClaims.consumedAt),
    )).run()
    tx.insert(authSetupClaims).values({
      id: randomUUID(),
      purpose: "head_coach_setup",
      tokenHash: setupClaimHash(token),
      createdByAccountId: input.createdByAccountId,
      expiresAt,
      claimedAt: input.claimImmediately ? now : null,
      createdAt: now,
      updatedAt: now,
    }).run()
    return { expiresAt, token }
  }, { behavior: "immediate" })
}

export function claimHeadCoachSetupToken(
  value: string | null | undefined,
  {
    database = initializeDatabase(),
    now = new Date(),
  }: {
    database?: SmbaDatabase
    now?: Date
  } = {},
) {
  if (!value?.trim() || !headCoachSetupAvailable({ database })) return false
  return database.transaction((tx) => {
    const result = tx.update(authSetupClaims).set({ claimedAt: now, updatedAt: now }).where(and(
      eq(authSetupClaims.purpose, "head_coach_setup"),
      eq(authSetupClaims.tokenHash, setupClaimHash(value)),
      gt(authSetupClaims.expiresAt, now),
      isNull(authSetupClaims.claimedAt),
      isNull(authSetupClaims.consumedAt),
    )).run()
    return result.changes === 1
  }, { behavior: "immediate" })
}

export function validHeadCoachSetupToken(
  value: string | null | undefined,
  {
    database = initializeDatabase(),
    now = new Date(),
  }: {
    database?: SmbaDatabaseExecutor
    now?: Date
  } = {},
) {
  if (!value?.trim()) return false
  return Boolean(database.select({ id: authSetupClaims.id }).from(authSetupClaims).where(and(
    eq(authSetupClaims.purpose, "head_coach_setup"),
    eq(authSetupClaims.tokenHash, setupClaimHash(value)),
    gt(authSetupClaims.expiresAt, now),
    isNull(authSetupClaims.consumedAt),
  )).get())
}

function consumeHeadCoachSetupClaim(
  value: string,
  {
    database,
    now,
  }: {
    database: SmbaDatabaseExecutor
    now: Date
  },
) {
  const result = database.update(authSetupClaims).set({ consumedAt: now, updatedAt: now }).where(and(
    eq(authSetupClaims.purpose, "head_coach_setup"),
    eq(authSetupClaims.tokenHash, setupClaimHash(value)),
    gt(authSetupClaims.expiresAt, now),
    isNull(authSetupClaims.consumedAt),
  )).run()
  return result.changes === 1
}

export function platformAdminSetupAvailable({
  database = initializeDatabase(),
}: {
  database?: SmbaDatabaseExecutor
} = {}) {
  return !database.select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.role, "platform_admin"))
    .get()
}

export type InitialPlatformAdminSetupInput = {
  confirmPassword: string
  confirmPin: string
  fullName: string
  password: string
  pin: string
}

function validateInitialPlatformAdminSetup(input: InitialPlatformAdminSetupInput) {
  const fullName = normalizeFullName(input.fullName)
  if (fullName.length < 2 || fullName.length > 80) return "Enter your full name."
  const passwordError = validateNewPassword(input.password)
  if (passwordError) return passwordError
  if (input.password !== input.confirmPassword) return "The passwords do not match."
  const pinError = validatePin(input.pin)
  if (pinError) return pinError
  if (input.pin !== input.confirmPin) return "The PINs do not match."
  return null
}

export async function completeInitialPlatformAdminSetup(
  input: InitialPlatformAdminSetupInput,
  {
    database = initializeDatabase(),
    now = new Date(),
  }: {
    database?: SmbaDatabase
    now?: Date
  } = {},
) {
  const validationError = validateInitialPlatformAdminSetup(input)
  if (validationError) throw new Error(validationError)
  const fullName = normalizeFullName(input.fullName)
  const [passwordHash, pinHash] = await Promise.all([
    hashPassword(input.password),
    hashPassword(input.pin),
  ])

  return database.transaction((tx) => {
    if (!platformAdminSetupAvailable({ database: tx })
      || tx.select({ id: authMethods.id }).from(authMethods)
        .where(eq(authMethods.identifier, PLATFORM_ADMIN_ACADEMY_ID)).get()) {
      throw new Error("The platform-owner account has already been configured.")
    }
    tx.insert(accounts).values({
      id: PLATFORM_ADMIN_ACCOUNT_ID,
      fullName,
      normalizedName: normalizedNameKey(fullName),
      requestedRole: "platform_admin",
      role: "platform_admin",
      approvalStatus: "approved",
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    }).run()
    tx.insert(authMethods).values({
      id: randomUUID(),
      accountId: PLATFORM_ADMIN_ACCOUNT_ID,
      method: "academy_id",
      identifier: PLATFORM_ADMIN_ACADEMY_ID,
      createdAt: now,
    }).run()
    upsertPasswordCredential({
      academyId: PLATFORM_ADMIN_ACADEMY_ID,
      accountId: PLATFORM_ADMIN_ACCOUNT_ID,
      fullName,
      passwordHash,
    }, { database: tx, now })
    tx.insert(authPinCredentials).values({
      accountId: PLATFORM_ADMIN_ACCOUNT_ID,
      pinHash,
      createdAt: now,
      updatedAt: now,
    }).run()
    writeAuthSecurityEvent({
      accountId: PLATFORM_ADMIN_ACCOUNT_ID,
      actorAccountId: PLATFORM_ADMIN_ACCOUNT_ID,
      eventType: "account_activated",
      outcome: "success",
    }, { database: tx, now })
    writeAuthSecurityEvent({
      accountId: PLATFORM_ADMIN_ACCOUNT_ID,
      actorAccountId: PLATFORM_ADMIN_ACCOUNT_ID,
      eventType: "pin_created",
      outcome: "success",
    }, { database: tx, now })
    return {
      accountId: PLATFORM_ADMIN_ACCOUNT_ID,
      academyId: PLATFORM_ADMIN_ACADEMY_ID,
      fullName,
    }
  }, { behavior: "immediate" })
}

export function headCoachSetupAvailable({
  database = initializeDatabase(),
}: {
  database?: SmbaDatabaseExecutor
} = {}) {
  return !database.select({ accountId: coachProfiles.accountId })
    .from(coachProfiles)
    .where(eq(coachProfiles.accessLevel, "head_admin"))
    .get()
}

export type InitialHeadCoachSetupInput = {
  confirmPassword: string
  confirmPin: string
  fullName: string
  password: string
  pin: string
  recoveryEmailReceiptToken: string
  recoveryEmailSubjectKey: string
  setupToken: string
}

export function validateInitialHeadCoachSetup(input: InitialHeadCoachSetupInput) {
  const fullName = normalizeFullName(input.fullName)
  if (fullName.length < 2 || fullName.length > 80) return "Enter the head coach’s full name."
  const passwordError = validateNewPassword(input.password)
  if (passwordError) return passwordError
  if (input.password !== input.confirmPassword) return "The passwords do not match."
  const pinError = validatePin(input.pin)
  if (pinError) return pinError
  if (input.pin !== input.confirmPin) return "The PINs do not match."
  return null
}

export async function completeInitialHeadCoachSetup(
  input: InitialHeadCoachSetupInput,
  {
    database = initializeDatabase(),
    now = new Date(),
  }: {
    database?: SmbaDatabase
    now?: Date
  } = {},
) {
  const validationError = validateInitialHeadCoachSetup(input)
  if (validationError) throw new Error(validationError)
  const fullName = normalizeFullName(input.fullName)
  const accountId = randomUUID()
  const [passwordHash, pinHash] = await Promise.all([
    hashPassword(input.password),
    hashPassword(input.pin),
  ])

  return database.transaction((tx) => {
    if (!consumeHeadCoachSetupClaim(input.setupToken, { database: tx, now })) {
      throw new Error("This one-time setup session is unavailable or has already been used.")
    }
    if (!headCoachSetupAvailable({ database: tx })) {
      throw new Error("The head-coach account has already been configured.")
    }
    if (tx.select({ id: authMethods.id }).from(authMethods)
      .where(eq(authMethods.identifier, HEAD_COACH_ACADEMY_ID)).get()) {
      throw new Error("The head-coach account has already been configured.")
    }

    tx.insert(accounts).values({
      id: accountId,
      fullName,
      normalizedName: normalizedNameKey(fullName),
      requestedRole: "coach",
      role: "coach",
      approvalStatus: "approved",
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    }).run()
    tx.insert(academyIdAllocations).values({
      serial: ACADEMY_ID_SERIAL_RANGES.headCoach.first,
      accountId,
      createdAt: now,
    }).run()
    tx.insert(authMethods).values({
      id: randomUUID(),
      accountId,
      method: "academy_id",
      identifier: HEAD_COACH_ACADEMY_ID,
      createdAt: now,
    }).run()
    tx.insert(coachProfiles).values({
      accountId,
      accessLevel: "head_admin",
      joinedOn: getAcademyDateKey(now),
      createdAt: now,
      updatedAt: now,
    }).run()
    const recoveryEmail = consumeVerifiedSetupRecoveryEmail({
      accountId,
      receiptToken: input.recoveryEmailReceiptToken,
      subjectKey: input.recoveryEmailSubjectKey,
    }, { database: tx, now })
    if (!recoveryEmail) {
      throw new Error("Verify the recovery email before creating the head-coach account.")
    }
    upsertPasswordCredential({
      academyId: HEAD_COACH_ACADEMY_ID,
      accountId,
      fullName,
      passwordHash,
    }, { database: tx, now })
    tx.insert(authPinCredentials).values({
      accountId,
      pinHash,
      createdAt: now,
      updatedAt: now,
    }).run()
    writeAuthSecurityEvent({
      accountId,
      actorAccountId: accountId,
      eventType: "account_activated",
      outcome: "success",
    }, { database: tx, now })
    writeAuthSecurityEvent({
      accountId,
      actorAccountId: accountId,
      eventType: "pin_created",
      outcome: "success",
    }, { database: tx, now })
    return { accountId, academyId: HEAD_COACH_ACADEMY_ID, fullName }
  }, { behavior: "immediate" })
}
