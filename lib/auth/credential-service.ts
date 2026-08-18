import "server-only"

import { createHash, createHmac, randomBytes, randomUUID, scryptSync } from "node:crypto"

import { and, eq, gt, isNull, lt } from "drizzle-orm"
import { hashPassword, verifyPassword } from "better-auth/crypto"

import {
  isAcademyId,
  normalizeAcademyId,
  normalizeFullName,
  normalizedNameKey,
  PLATFORM_ADMIN_ACADEMY_ID,
} from "@/lib/auth/identity"
import { initializeDatabase, type SmbaDatabase, type SmbaDatabaseExecutor } from "@/lib/db/client"
import {
  accounts,
  authActivationClaims,
  authAccessCodes,
  authCredentialStates,
  authLoginAttempts,
  authMethods,
  authPinCredentials,
  authProviderAccounts,
  authRecoveryEmails,
  authRuntimeSessions,
  authUsers,
  coachProfiles,
} from "@/lib/db/schema"
import { authSubjectHash, writeAuthSecurityEvent } from "@/lib/auth/security-context"

export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 128
export const LOCAL_DEVELOPMENT_PASSWORD = "SMBA local access 2026!"
export const FIXTURE_PASSWORD = "SMBA fixture access 2026!"
export const PLATFORM_ADMIN_ACCOUNT_ID = "00000000-0000-4000-8000-0000000000a1"
export const ACTIVATION_CLAIM_COOKIE = "smba_activation_claim"
export const ACTIVATION_CLAIM_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_BLOCK_MS = 15 * 60 * 1000

function credentialSecret() {
  return process.env.BETTER_AUTH_SECRET?.trim()
    || "smba-local-only-credential-secret-change-before-deployment-2026"
}

function credentialHash(label: string, value: string) {
  return createHmac("sha256", credentialSecret())
    .update(`${label}:${value}`)
    .digest("hex")
}

export function createActivationClaimToken() {
  return randomBytes(32).toString("base64url")
}

export function activationClaimHash(value: string) {
  return credentialHash("activation-claim", value.trim())
}

export function validatePin(pin: string) {
  return /^\d{6}$/u.test(pin) ? null : "Enter exactly 6 digits."
}

function internalEmail(accountId: string) {
  return `${accountId}@accounts.smba.invalid`
}

export function validateNewPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Keep the password to ${MAX_PASSWORD_LENGTH} characters or fewer.`
  }
  return null
}

export type ActivationClaimStatus =
  | { state: "missing" | "expired" | "rejected" }
  | { accountId: string; fullName: string; state: "pending" }
  | {
    academyId: string
    accountId: string
    fullName: string
    role: "coach" | "player"
    state: "approved" | "active"
  }

export function saveActivationClaim(input: {
  accountId: string
  token: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  if (!/^[A-Za-z0-9_-]{40,}$/u.test(input.token)) {
    throw new Error("A secure activation claim is required.")
  }
  const expiresAt = new Date(now.getTime() + ACTIVATION_CLAIM_LIFETIME_MS)
  database.insert(authActivationClaims).values({
    accountId: input.accountId,
    tokenHash: activationClaimHash(input.token),
    expiresAt,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: authActivationClaims.accountId,
    set: {
      consumedAt: null,
      expiresAt,
      tokenHash: activationClaimHash(input.token),
      updatedAt: now,
    },
  }).run()
  return expiresAt
}

export function extendActivationClaim(accountId: string, {
  database,
  now = new Date(),
}: {
  database: SmbaDatabaseExecutor
  now?: Date
}) {
  database.update(authActivationClaims).set({
    expiresAt: new Date(now.getTime() + ACTIVATION_CLAIM_LIFETIME_MS),
    updatedAt: now,
  }).where(and(
    eq(authActivationClaims.accountId, accountId),
    isNull(authActivationClaims.consumedAt),
  )).run()
}

export function getActivationClaimStatus(token: string | null | undefined, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}): ActivationClaimStatus {
  if (!token?.trim()) return { state: "missing" }
  const row = database.select({
    academyId: authMethods.identifier,
    accountId: accounts.id,
    approvalStatus: accounts.approvalStatus,
    archivedAt: accounts.archivedAt,
    consumedAt: authActivationClaims.consumedAt,
    credentialStatus: authCredentialStates.status,
    expiresAt: authActivationClaims.expiresAt,
    fullName: accounts.fullName,
    role: accounts.role,
  }).from(authActivationClaims)
    .innerJoin(accounts, eq(accounts.id, authActivationClaims.accountId))
    .leftJoin(authMethods, and(
      eq(authMethods.accountId, accounts.id),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
    ))
    .leftJoin(authCredentialStates, eq(authCredentialStates.accountId, accounts.id))
    .where(eq(authActivationClaims.tokenHash, activationClaimHash(token)))
    .get()

  if (!row || row.archivedAt || row.consumedAt) return { state: "missing" }
  if (row.expiresAt <= now) return { state: "expired" }
  if (row.approvalStatus === "rejected") return { state: "rejected" }
  if (row.approvalStatus === "pending") {
    return { accountId: row.accountId, fullName: row.fullName, state: "pending" }
  }
  if (!row.academyId || (row.role !== "coach" && row.role !== "player")) {
    return { state: "missing" }
  }
  return {
    academyId: row.academyId,
    accountId: row.accountId,
    fullName: row.fullName,
    role: row.role,
    state: row.credentialStatus === "active" ? "active" : "approved",
  }
}

const developmentPasswordHashes = new Map<string, string>()

function createDevelopmentPasswordHash(password: string) {
  const cached = developmentPasswordHashes.get(password)
  if (cached) return cached
  // Every account in a disposable fixture intentionally shares one documented
  // password. Reusing its expensive hash keeps 100-player fixture builds fast;
  // this path is hard-disabled on Vercel and is never used for real accounts.
  const salt = createHash("sha256").update(`smba-development-salt:${password}`).digest("hex").slice(0, 32)
  const key = scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    maxmem: 128 * 16384 * 16 * 2,
    p: 1,
    r: 16,
  })
  const passwordHash = `${salt}:${key.toString("hex")}`
  developmentPasswordHashes.set(password, passwordHash)
  return passwordHash
}

function createProductionPasswordHash(password: string) {
  const salt = randomBytes(16).toString("hex")
  const key = scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    maxmem: 128 * 16384 * 16 * 2,
    p: 1,
    r: 16,
  })
  return `${salt}:${key.toString("hex")}`
}

export function upsertPasswordCredential(input: {
  academyId: string
  accountId: string
  fullName: string
  passwordHash: string
}, {
  database,
  now,
}: {
  database: SmbaDatabaseExecutor
  now: Date
}) {
  const academyId = normalizeAcademyId(input.academyId)
  database.insert(authUsers).values({
    id: input.accountId,
    createdAt: now,
    displayUsername: academyId,
    email: internalEmail(input.accountId),
    emailVerified: true,
    name: input.fullName,
    twoFactorEnabled: false,
    updatedAt: now,
    username: academyId,
  }).onConflictDoUpdate({
    target: authUsers.id,
    set: {
      displayUsername: academyId,
      name: input.fullName,
      updatedAt: now,
      username: academyId,
    },
  }).run()
  database.insert(authProviderAccounts).values({
    id: randomUUID(),
    accountId: input.accountId,
    createdAt: now,
    password: input.passwordHash,
    providerId: "credential",
    updatedAt: now,
    userId: input.accountId,
  }).onConflictDoUpdate({
    target: [authProviderAccounts.providerId, authProviderAccounts.accountId],
    set: {
      password: input.passwordHash,
      updatedAt: now,
      userId: input.accountId,
    },
  }).run()
  database.insert(authCredentialStates).values({
    accountId: input.accountId,
    activatedAt: now,
    passwordChangedAt: now,
    status: "active",
    updatedAt: now,
  }).onConflictDoUpdate({
    target: authCredentialStates.accountId,
    set: {
      activatedAt: now,
      passwordChangedAt: now,
      status: "active",
      updatedAt: now,
    },
  }).run()
  database.update(authAccessCodes).set({ consumedAt: now }).where(and(
    eq(authAccessCodes.accountId, input.accountId),
    isNull(authAccessCodes.consumedAt),
  )).run()
}

export function provisionDevelopmentCredential(input: {
  academyId: string
  accountId: string
  fullName: string
  password?: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  if (!isAcademyId(input.academyId)) throw new Error("A valid Academy ID is required.")
  if (process.env.VERCEL === "1") {
    throw new Error("Development credentials must never be provisioned during a Vercel deployment.")
  }
  const password = input.password
    ?? process.env.SMBA_LOCAL_AUTH_PASSWORD
    ?? LOCAL_DEVELOPMENT_PASSWORD
  upsertPasswordCredential({
    academyId: input.academyId,
    accountId: input.accountId,
    fullName: input.fullName,
    passwordHash: createDevelopmentPasswordHash(password),
  }, { database, now })
}

export async function completeAccountActivation(input: {
  password: string
  token: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  if (validateNewPassword(input.password)) return null
  const status = getActivationClaimStatus(input.token, { database, now })
  if (status.state !== "approved") return null
  if (!database.select({ accountId: authRecoveryEmails.accountId })
    .from(authRecoveryEmails)
    .where(eq(authRecoveryEmails.accountId, status.accountId))
    .get()) return null
  const passwordHash = await hashPassword(input.password)
  const completed = database.transaction((tx) => {
    const currentClaim = tx.select({ accountId: authActivationClaims.accountId })
      .from(authActivationClaims)
      .innerJoin(authCredentialStates, and(
        eq(authCredentialStates.accountId, authActivationClaims.accountId),
        eq(authCredentialStates.status, "pending"),
      ))
      .where(and(
        eq(authActivationClaims.accountId, status.accountId),
        eq(authActivationClaims.tokenHash, activationClaimHash(input.token)),
        isNull(authActivationClaims.consumedAt),
        gt(authActivationClaims.expiresAt, now),
      ))
      .get()
    if (!currentClaim) return false
    if (tx.select({ id: authUsers.id }).from(authUsers)
      .where(eq(authUsers.id, status.accountId)).get()) return false

    tx.insert(authUsers).values({
      id: status.accountId,
      createdAt: now,
      displayUsername: status.academyId,
      email: internalEmail(status.accountId),
      emailVerified: true,
      name: status.fullName,
      twoFactorEnabled: false,
      updatedAt: now,
      username: status.academyId,
    }).run()
    tx.insert(authProviderAccounts).values({
      id: randomUUID(),
      accountId: status.accountId,
      createdAt: now,
      password: passwordHash,
      providerId: "credential",
      updatedAt: now,
      userId: status.accountId,
    }).run()
    tx.update(authActivationClaims).set({ consumedAt: now, updatedAt: now })
      .where(eq(authActivationClaims.accountId, status.accountId)).run()
    tx.update(authCredentialStates).set({
      activatedAt: now,
      passwordChangedAt: now,
      status: "active",
      updatedAt: now,
    }).where(eq(authCredentialStates.accountId, status.accountId)).run()
    tx.delete(authRuntimeSessions).where(eq(authRuntimeSessions.userId, status.accountId)).run()
    writeAuthSecurityEvent({
      accountId: status.accountId,
      eventType: "account_activated",
      outcome: "success",
      subjectHash: authSubjectHash(status.academyId),
    }, { database: tx, now })
    return true
  }, { behavior: "immediate" })

  return completed ? status : null
}

export function hasPinCredential(accountId: string, {
  database = initializeDatabase(),
}: {
  database?: SmbaDatabaseExecutor
} = {}) {
  return Boolean(database.select({ accountId: authPinCredentials.accountId })
    .from(authPinCredentials)
    .where(eq(authPinCredentials.accountId, accountId))
    .get())
}

function pinEligibleAccount(accountId: string, database: SmbaDatabaseExecutor) {
  return database.select({
    accessLevel: coachProfiles.accessLevel,
    accountId: accounts.id,
    role: accounts.role,
  }).from(accounts)
    .innerJoin(authCredentialStates, and(
      eq(authCredentialStates.accountId, accounts.id),
      eq(authCredentialStates.status, "active"),
    ))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(and(
      eq(accounts.id, accountId),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .get()
}

export async function setPinCredential(input: {
  accountId: string
  pin: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const pinError = validatePin(input.pin)
  if (pinError) throw new Error(pinError)
  const account = pinEligibleAccount(input.accountId, database)
  if (!account?.role
    || (account.role !== "player"
      && account.role !== "coach"
      && account.role !== "platform_admin")) {
    throw new Error("PIN login is unavailable for this account.")
  }
  const pinHash = await hashPassword(input.pin)
  const existing = hasPinCredential(input.accountId, { database })
  database.insert(authPinCredentials).values({
    accountId: input.accountId,
    pinHash,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: authPinCredentials.accountId,
    set: { pinHash, updatedAt: now },
  }).run()
  writeAuthSecurityEvent({
    accountId: input.accountId,
    actorAccountId: input.accountId,
    eventType: existing ? "pin_changed" : "pin_created",
    outcome: "success",
  }, { database, now })
  return { created: !existing }
}

export function removePinCredential(accountId: string, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const result = database.delete(authPinCredentials)
    .where(eq(authPinCredentials.accountId, accountId)).run()
  if (result.changes) {
    writeAuthSecurityEvent({
      accountId,
      actorAccountId: accountId,
      eventType: "pin_removed",
      outcome: "success",
    }, { database, now })
  }
  return Boolean(result.changes)
}

export async function verifyCurrentPassword(input: {
  accountId: string
  password: string
}, {
  database = initializeDatabase(),
}: {
  database?: SmbaDatabaseExecutor
} = {}) {
  const stored = database.select({ password: authProviderAccounts.password })
    .from(authProviderAccounts)
    .where(and(
      eq(authProviderAccounts.userId, input.accountId),
      eq(authProviderAccounts.providerId, "credential"),
    ))
    .get()?.password
  return Boolean(stored && await verifyPassword({ hash: stored, password: input.password }))
}

export async function verifyPinLogin(input: {
  academyId: string
  pin: string
}, {
  database = initializeDatabase(),
}: {
  database?: SmbaDatabaseExecutor
} = {}) {
  const academyId = normalizeAcademyId(input.academyId)
  const row = database.select({
    accessLevel: coachProfiles.accessLevel,
    accountId: accounts.id,
    pinHash: authPinCredentials.pinHash,
    role: accounts.role,
    twoFactorEnabled: authUsers.twoFactorEnabled,
  }).from(authMethods)
    .innerJoin(accounts, eq(accounts.id, authMethods.accountId))
    .innerJoin(authCredentialStates, and(
      eq(authCredentialStates.accountId, accounts.id),
      eq(authCredentialStates.status, "active"),
    ))
    .innerJoin(authUsers, eq(authUsers.id, accounts.id))
    .innerJoin(authPinCredentials, eq(authPinCredentials.accountId, accounts.id))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(and(
      eq(authMethods.identifier, academyId),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    ))
    .get()

  const eligible = row?.role === "player"
    || row?.role === "coach"
    || row?.role === "platform_admin"
  if (!row || !eligible || validatePin(input.pin)) {
    await hashPassword(input.pin)
    return null
  }
  return await verifyPassword({ hash: row.pinHash, password: input.pin })
    ? {
      accountId: row.accountId,
      role: row.role,
      twoFactorEnabled: row.twoFactorEnabled,
    }
    : null
}

function attemptKeys(subjectHash: string, ipHash: string) {
  return [
    { key: `subject:${subjectHash}`, threshold: 5 },
    { key: `ip:${ipHash}`, threshold: 20 },
  ]
}

export function loginIsBlocked(input: {
  ipHash: string
  subjectHash: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  return attemptKeys(input.subjectHash, input.ipHash).some(({ key }) => {
    const row = database.select({ blockedUntil: authLoginAttempts.blockedUntil })
      .from(authLoginAttempts)
      .where(eq(authLoginAttempts.key, key))
      .get()
    return Boolean(row?.blockedUntil && row.blockedUntil > now)
  })
}

export function recordLoginFailure(input: {
  ipHash: string
  subjectHash: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  database.transaction((tx) => {
    for (const { key, threshold } of attemptKeys(input.subjectHash, input.ipHash)) {
      const current = tx.select().from(authLoginAttempts)
        .where(eq(authLoginAttempts.key, key)).get()
      const outsideWindow = !current
        || now.getTime() - current.windowStartedAt.getTime() >= LOGIN_WINDOW_MS
      const failedCount = outsideWindow ? 1 : current.failedCount + 1
      const blockedUntil = failedCount >= threshold
        ? new Date(now.getTime() + LOGIN_BLOCK_MS)
        : null
      tx.insert(authLoginAttempts).values({
        key,
        blockedUntil,
        failedCount,
        updatedAt: now,
        windowStartedAt: outsideWindow ? now : current.windowStartedAt,
      }).onConflictDoUpdate({
        target: authLoginAttempts.key,
        set: {
          blockedUntil,
          failedCount,
          updatedAt: now,
          windowStartedAt: outsideWindow ? now : current.windowStartedAt,
        },
      }).run()
    }
  }, { behavior: "immediate" })
}

export function recordLoginSuccess(subjectHash: string, {
  database = initializeDatabase(),
}: {
  database?: SmbaDatabaseExecutor
} = {}) {
  database.delete(authLoginAttempts)
    .where(eq(authLoginAttempts.key, `subject:${subjectHash}`))
    .run()
}

export function removeExpiredAccessCodes({
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  database.update(authAccessCodes).set({ consumedAt: now }).where(and(
    isNull(authAccessCodes.consumedAt),
    lt(authAccessCodes.expiresAt, now),
  )).run()
}

export function ensureBootstrapCredential({
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const headCoach = database.select({
    academyId: authMethods.identifier,
    accountId: coachProfiles.accountId,
    fullName: accounts.fullName,
  }).from(coachProfiles)
    .innerJoin(accounts, eq(accounts.id, coachProfiles.accountId))
    .innerJoin(authMethods, and(
      eq(authMethods.accountId, coachProfiles.accountId),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
    ))
    .where(eq(coachProfiles.accessLevel, "head_admin"))
    .get()
  if (!headCoach) return null
  const existingUser = database.select({ id: authUsers.id })
    .from(authUsers).where(eq(authUsers.id, headCoach.accountId)).get()

  if (!existingUser) {
    const password = process.env.SMBA_BOOTSTRAP_HEAD_COACH_PASSWORD?.trim()
    if (!password) {
      if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") {
        throw new Error("SMBA_BOOTSTRAP_HEAD_COACH_PASSWORD is required for a fresh production database.")
      }
      return null
    }
    const passwordError = validateNewPassword(password)
    if (passwordError) throw new Error(`SMBA_BOOTSTRAP_HEAD_COACH_PASSWORD: ${passwordError}`)
    upsertPasswordCredential({
      academyId: headCoach.academyId,
      accountId: headCoach.accountId,
      fullName: headCoach.fullName,
      passwordHash: createProductionPasswordHash(password),
    }, { database, now })
    writeAuthSecurityEvent({
      accountId: headCoach.accountId,
      actorAccountId: headCoach.accountId,
      eventType: "account_activated",
      outcome: "success",
      subjectHash: authSubjectHash(headCoach.academyId),
    }, { database, now })
    return headCoach.academyId
  }

  return null
}
