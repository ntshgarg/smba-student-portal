import "server-only"

import { createHash, createHmac, randomBytes, randomUUID, scryptSync } from "node:crypto"

import { and, eq, gt, isNull, like, lt, or } from "drizzle-orm"
import { hashPassword, verifyPassword } from "better-auth/crypto"

import {
  CREDENTIAL_ACCOUNT_ISSUER,
  isAcademyId,
  normalizeAcademyId,
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
  playerEnrollments,
} from "@/lib/db/schema"
import {
  UNKNOWN_IP_HASH,
  authSubjectHash,
  writeAuthSecurityEvent,
} from "@/lib/auth/security-context"

const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 128
const LOCAL_DEVELOPMENT_PASSWORD = "SMBA local access 2026!"
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

function activationClaimHash(value: string) {
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
  | { accountId: string; fullName: string; state: "pending" | "onboarding" }
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
    enrolledAccountId: playerEnrollments.accountId,
    expiresAt: authActivationClaims.expiresAt,
    fullName: accounts.fullName,
    onboardingCompletedAt: playerEnrollments.onboardingCompletedAt,
    role: accounts.role,
  }).from(authActivationClaims)
    .innerJoin(accounts, eq(accounts.id, authActivationClaims.accountId))
    .leftJoin(authMethods, and(
      eq(authMethods.accountId, accounts.id),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
    ))
    .leftJoin(authCredentialStates, eq(authCredentialStates.accountId, accounts.id))
    .leftJoin(playerEnrollments, eq(playerEnrollments.accountId, accounts.id))
    .where(eq(authActivationClaims.tokenHash, activationClaimHash(token)))
    .get()

  if (!row || row.archivedAt || row.consumedAt) return { state: "missing" }
  if (row.expiresAt <= now) return { state: "expired" }
  if (row.approvalStatus === "rejected") return { state: "rejected" }
  if (row.approvalStatus === "pending") {
    return { accountId: row.accountId, fullName: row.fullName, state: "pending" }
  }
  /*
   * A player may only set a password once the coach has finished onboarding
   * them. That rule used to live on one door only -- the status lookup withheld
   * the password step, while the receipt held by the browser they registered in
   * walked straight through. Enforcing it here puts it in front of both, and in
   * front of `completeAccountActivation`, which refuses anything that is not
   * "approved". An assistant coach has no enrollment row and no onboarding to
   * finish, so approval is the whole gate for them.
   */
  if (row.enrolledAccountId && !row.onboardingCompletedAt) {
    return { accountId: row.accountId, fullName: row.fullName, state: "onboarding" }
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
  // password. Reusing its expensive deterministic hash keeps fixture builds
  // reproducible and fast. provisionDevelopmentCredential hard-rejects Vercel;
  // real account activation uses Better Auth's randomly salted hashPassword.
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
    issuer: CREDENTIAL_ACCOUNT_ISSUER,
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
      issuer: CREDENTIAL_ACCOUNT_ISSUER,
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

export type CurrentPasswordAttemptResult = "blocked" | "invalid" | "verified"

export async function verifyCurrentPasswordAttempt(input: {
  accountId: string
  academyId: string
  ipHash: string
  operation: string
  password: string
  userAgent?: string | null
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}): Promise<CurrentPasswordAttemptResult> {
  const subjectHash = authSubjectHash(normalizeAcademyId(input.academyId))
  const attempt = { ipHash: input.ipHash, subjectHash }
  if (loginIsBlocked(attempt, { database, now })) {
    writeAuthSecurityEvent({
      accountId: input.accountId,
      actorAccountId: input.accountId,
      eventType: "login_rate_limited",
      ipHash: input.ipHash,
      metadata: { factor: "current_password", operation: input.operation },
      outcome: "blocked",
      subjectHash,
      userAgent: input.userAgent,
    }, { database, now })
    return "blocked"
  }
  if (!await verifyCurrentPassword({
    accountId: input.accountId,
    password: input.password,
  }, { database })) {
    recordLoginFailure(attempt, { database, now })
    writeAuthSecurityEvent({
      accountId: input.accountId,
      actorAccountId: input.accountId,
      eventType: "login_failed",
      ipHash: input.ipHash,
      metadata: { factor: "current_password", operation: input.operation },
      outcome: "failure",
      subjectHash,
      userAgent: input.userAgent,
    }, { database, now })
    return "invalid"
  }
  recordLoginSuccess(subjectHash, { database })
  return "verified"
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


/*
 * Which ceilings apply depends on whether the caller's address means anything.
 *
 * When it does -- a platform header on Vercel, or a proxy header the deployment
 * names -- three keys: five guesses per account per address, fifty per account
 * from everywhere, twenty per address across all accounts.
 *
 * When it does not, `ipHash` is one constant shared by every caller on earth,
 * and that changes what the keys MEAN rather than merely weakening them. The
 * previous round kept the pair key in that case, not noticing that
 * `subject:<hash>:<constant>` is simply a second account-wide key with a
 * threshold of five: so denial cost five requests rather than the fifty its own
 * comment claimed, and the fifty-key could never be reached because the five-key
 * blocked first. The comment and the behaviour disagreed by an order of
 * magnitude. Measured: five wrong passwords refused the holder of the right one.
 *
 * So in the shared case only the account-wide key applies. A ceiling nobody can
 * be told apart on must never be cheap, and it must never be per-caller when
 * there is no caller to be per.
 *
 * What this does not fix, and cannot here: with no attributable address there is
 * nothing to bound one machine guessing five secrets against every account in
 * turn. That is metered by `unknownBucketDelayMs` below, which slows rather than
 * refuses -- a bucket the whole world shares may take everyone's time, never
 * anyone's access.
 */
const ACCOUNT_WIDE_FAILURE_THRESHOLD = 50

function attemptKeys(subjectHash: string, ipHash: string) {
  if (ipHash === UNKNOWN_IP_HASH) {
    return [{ key: `subject:${subjectHash}`, threshold: ACCOUNT_WIDE_FAILURE_THRESHOLD }]
  }
  return [
    { key: `subject:${subjectHash}:${ipHash}`, threshold: 5 },
    { key: `subject:${subjectHash}`, threshold: ACCOUNT_WIDE_FAILURE_THRESHOLD },
    { key: `ip:${ipHash}`, threshold: 20 },
  ]
}

/*
 * How long a caller in the shared "unknown" bucket waits before an answer.
 *
 * With no attributable address, nothing can bound one machine guessing five
 * secrets against every account in turn -- measured at 39 requests a second, so
 * five common PINs against a hundred-child roster takes seconds. Refusing is not
 * available: a bucket the whole world shares must never deny anybody.
 *
 * Taking their time is available. The delay rises with how much failure that
 * shared bucket has seen recently and is capped, so a spray runs at a few
 * attempts a second instead of forty while an honest person mistyping once pays
 * nothing. It is a tax, not a gate, and it is second best -- naming a forwarded
 * header the proxy actually writes is what makes the real ceilings work.
 */
const UNKNOWN_BUCKET_DELAY_STEP_MS = 250
const UNKNOWN_BUCKET_DELAY_CAP_MS = 2_000

export function unknownBucketDelayMs(ipHash: string, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  if (ipHash !== UNKNOWN_IP_HASH) return 0
  const windowStart = new Date(now.getTime() - LOGIN_WINDOW_MS)
  const recentFailures = database.select({ failedCount: authLoginAttempts.failedCount })
    .from(authLoginAttempts)
    .where(gt(authLoginAttempts.windowStartedAt, windowStart))
    .all()
    .reduce((total, row) => total + row.failedCount, 0)
  // Free for the first handful, so one mistyped password costs nobody anything.
  if (recentFailures <= 10) return 0
  return Math.min((recentFailures - 10) * UNKNOWN_BUCKET_DELAY_STEP_MS, UNKNOWN_BUCKET_DELAY_CAP_MS)
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
    /*
     * Rows past their window are spent: nothing reads them, and they cannot come
     * back because a stale window resets the count. Left alone the table grew
     * one row per unauthenticated failure and never shrank, on a database that
     * is Turso in production. Cleared here rather than on a schedule so the
     * cost lands on the writer producing the rows.
     */
    tx.delete(authLoginAttempts).where(and(
      lt(authLoginAttempts.windowStartedAt, new Date(now.getTime() - LOGIN_WINDOW_MS)),
      or(
        isNull(authLoginAttempts.blockedUntil),
        lt(authLoginAttempts.blockedUntil, now),
      ),
    )).run()
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

/**
 * Clears every failure recorded against this account, from any address.
 *
 * The subject key carries the requester's address now, so a single equality
 * would leave a block standing on a row the successful client never wrote --
 * proving you hold the password has to end the lockout, not just the lockout
 * you happened to cause. The hash is hex, so it carries no LIKE wildcards.
 */
export function recordLoginSuccess(subjectHash: string, {
  database = initializeDatabase(),
}: {
  database?: SmbaDatabaseExecutor
} = {}) {
  // The LIKE below interpolates this value. Every caller today routes it through
  // authSubjectHash, so it is 64 hex characters and carries no wildcard -- but
  // that was an assertion in a comment and nothing enforced it. A future caller
  // passing a raw academy ID or an email would let a "%" clear every other
  // account's counters.
  if (!/^[0-9a-f]{64}$/u.test(subjectHash)) {
    throw new Error("recordLoginSuccess requires a hashed subject.")
  }
  database.delete(authLoginAttempts)
    .where(or(
      eq(authLoginAttempts.key, `subject:${subjectHash}`),
      like(authLoginAttempts.key, `subject:${subjectHash}:%`),
    ))
    .run()
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
