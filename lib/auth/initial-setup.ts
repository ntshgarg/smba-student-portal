import "server-only"

import { createHash, randomUUID, timingSafeEqual } from "node:crypto"

import { eq } from "drizzle-orm"
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
  coachProfiles,
} from "@/lib/db/schema"
import { getAcademyDateKey } from "@/lib/format"

export const HEAD_COACH_SETUP_COOKIE = "smba_head_coach_setup"
export const LOCAL_HEAD_COACH_SETUP_TOKEN = "smba-local-head-coach-setup-token-2026"
export const PLATFORM_ADMIN_SETUP_COOKIE = "smba_platform_admin_setup"
export const LOCAL_PLATFORM_ADMIN_SETUP_TOKEN = "smba-local-platform-admin-setup-token-2026"

function configuredSetupToken() {
  const configured = process.env.SMBA_HEAD_COACH_SETUP_TOKEN?.trim()
  if (configured) return configured
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") {
    throw new Error("SMBA_HEAD_COACH_SETUP_TOKEN is required for first-run head-coach setup.")
  }
  return LOCAL_HEAD_COACH_SETUP_TOKEN
}

function configuredPlatformAdminSetupToken() {
  const configured = process.env.SMBA_PLATFORM_ADMIN_SETUP_TOKEN?.trim()
  if (configured) return configured
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") {
    throw new Error("SMBA_PLATFORM_ADMIN_SETUP_TOKEN is required for first-run platform-owner setup.")
  }
  return LOCAL_PLATFORM_ADMIN_SETUP_TOKEN
}

export function validateInitialSetupConfiguration() {
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") {
    configuredPlatformAdminSetupToken()
    configuredSetupToken()
  }
}

export function headCoachSetupTokenForTrustedServerAction() {
  return configuredSetupToken()
}

function digest(value: string) {
  return createHash("sha256").update(value).digest()
}

export function validHeadCoachSetupToken(value: string | null | undefined) {
  if (!value?.trim()) return false
  return timingSafeEqual(digest(value.trim()), digest(configuredSetupToken()))
}

export function validPlatformAdminSetupToken(value: string | null | undefined) {
  if (!value?.trim()) return false
  return timingSafeEqual(
    digest(value.trim()),
    digest(configuredPlatformAdminSetupToken()),
  )
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

export function validateInitialPlatformAdminSetup(input: InitialPlatformAdminSetupInput) {
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
