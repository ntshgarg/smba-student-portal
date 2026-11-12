import "server-only"

import { resolveAuthSecret } from "@/lib/auth/auth-secret"
import { createHash, createHmac, randomBytes, randomUUID, scryptSync } from "node:crypto"

import { and, eq, gt, isNull, like, lt, or } from "drizzle-orm"
import { hashPassword, verifyPassword } from "better-auth/crypto"

import {
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
  unknownIpHash,
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
  return resolveAuthSecret("smba-local-only-credential-secret-change-before-deployment-2026")
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

/**
 * Shape only. This is what sign-in checks, so a PIN chosen before the strength
 * rules below existed still signs in; use `validateNewPin` when one is being set.
 */
export function validatePin(pin: string) {
  return /^\d{6}$/u.test(pin) ? null : "Enter exactly 6 digits."
}

const WEAK_PIN_MESSAGE =
  "That PIN is too easy to guess. Avoid repeats, counting up or down, and birthdays."

// The sixty-odd six-digit codes people reach for first. Patterns below catch
// runs and repeats; this list catches the rest (keyboard shapes, 123321, 520520).
const COMMON_PINS = new Set([
  "000000", "001122", "010203", "010101", "100200", "101010", "102030",
  "111222", "112233", "121212", "123123", "123321", "123456", "123654",
  "124578", "131313", "147258", "159753", "159357", "192837", "200000",
  "202020", "212121", "232323", "321321", "333666", "456456", "456789",
  "520131", "520520", "555666", "654321", "666888", "696969", "741852",
  "753951", "778899", "789456", "789789", "888999", "987654", "987456",
  "998877", "999000", "135790", "246810", "135246", "142536", "162534",
  "090909", "707070", "181818", "191919", "909090", "808080", "151515",
  "171717", "141414", "161616", "252525",
])

function isDateLike(pin: string) {
  // The three orders people write a date in: ddmmyy, mmddyy, yymmdd.
  const candidates: Array<{ day: number, month: number, year: number }> = [
    { day: Number(pin.slice(0, 2)), month: Number(pin.slice(2, 4)), year: Number(pin.slice(4, 6)) },
    { day: Number(pin.slice(2, 4)), month: Number(pin.slice(0, 2)), year: Number(pin.slice(4, 6)) },
    { day: Number(pin.slice(4, 6)), month: Number(pin.slice(2, 4)), year: Number(pin.slice(0, 2)) },
  ]
  // Birth years of the people who hold these PINs: players (2000s onwards) and
  // the adults around them (1970 onwards). A real calendar day and month.
  return candidates.some(({ day, month, year }) =>
    day >= 1 && day <= 31 && month >= 1 && month <= 12
    && (year <= 26 || year >= 70))
}

/**
 * What a PIN has to clear to be *set*. A PIN is the only factor a player -- a
 * minor -- signs in with, and the Academy ID beside it is sequential, so a PIN
 * from the first few hundred anyone would try is as good as none.
 */
export function validateNewPin(pin: string) {
  const shape = validatePin(pin)
  if (shape) return shape
  const digits = [...pin].map(Number)
  const allSame = digits.every((digit) => digit === digits[0])
  const step = digits[1] - digits[0]
  const isRun = Math.abs(step) === 1
    && digits.every((digit, index) => index === 0 || digit - digits[index - 1] === step)
  // 121212, 123123, 112112: the first two or three digits repeated.
  const repeatsPair = pin.slice(0, 2).repeat(3) === pin
  const repeatsTriple = pin.slice(0, 3).repeat(2) === pin
  // 112233, 445566: three pairs of doubled digits.
  const pairedDoubles = digits[0] === digits[1] && digits[2] === digits[3] && digits[4] === digits[5]
  if (allSame || isRun || repeatsPair || repeatsTriple || pairedDoubles
    || COMMON_PINS.has(pin) || isDateLike(pin)) {
    return WEAK_PIN_MESSAGE
  }
  return null
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

  if (!row || row.archivedAt) return { state: "missing" }
  if (row.consumedAt) {
    /*
     * Activation spends the receipt in the same step that sets the password, so
     * a spent receipt on an account with a password is the browser that just
     * activated. It used to read as "missing", which showed that browser the
     * name-and-email lookup instead of "your account is ready, sign in" --
     * including right after a sign-in hiccup, when that was the one thing the
     * person needed to hear. It grants nothing: activation refuses "active".
     */
    return row.credentialStatus === "active"
      && row.academyId
      && (row.role === "coach" || row.role === "player")
      ? {
        academyId: row.academyId,
        accountId: row.accountId,
        fullName: row.fullName,
        role: row.role,
        state: "active",
      }
      : { state: "missing" }
  }
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
  const pinError = validateNewPin(input.pin)
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
  reason,
}: {
  database?: SmbaDatabase
  now?: Date
  reason?: "weak_legacy_pin"
} = {}) {
  const result = database.delete(authPinCredentials)
    .where(eq(authPinCredentials.accountId, accountId)).run()
  if (result.changes) {
    writeAuthSecurityEvent({
      accountId,
      actorAccountId: accountId,
      eventType: "pin_removed",
      ...(reason ? { metadata: { reason } } : {}),
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
  // Reserved before the slow verify, not counted after it, so a burst of
  // parallel guesses cannot all slip in under the ceiling (see reserveLoginAttempt).
  if (!reserveLoginAttempt(attempt, { database, now })) {
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
    // Already counted by the reservation.
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
  releaseLoginAttempt(attempt, { database, now })
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
 * nothing to bound one machine guessing fifty secrets against every account in
 * turn. A delay was tried and removed -- see the note on the boot warning in
 * lib/auth/security-context.ts. The answer is configuration, not code: name a
 * forwarded header the proxy actually writes and the real ceilings work.
 */
const ACCOUNT_WIDE_FAILURE_THRESHOLD = 50
const IP_FAILURE_THRESHOLD = 20

/*
 * A six-digit PIN has a million values, where a password has far more than can
 * be tried, so the generic fifty-a-quarter-hour budget is too generous for it:
 * 4,800 guesses a day is half a percent of the space, daily, indefinitely. PIN
 * sign-in gets its own, tighter account-wide budget. It is a separate key that
 * only PIN sign-in reads, and only a verified PIN clears it: signing in some
 * other way does not hand an attacker a fresh ten.
 *
 * What it does not do is keep PIN guessing away from the password form. PIN
 * attempts also spend the shared per-address and per-account keys, so five wrong
 * PINs from one address still pause the password form from that address.
 */
const PIN_ACCOUNT_WIDE_FAILURE_THRESHOLD = 10

export type LoginFactor = "pin"

function attemptKeys(subjectHash: string, ipHash: string, factor?: LoginFactor) {
  const factorKeys = factor === "pin"
    ? [{ key: `pin:${subjectHash}`, threshold: PIN_ACCOUNT_WIDE_FAILURE_THRESHOLD }]
    : []
  if (ipHash === unknownIpHash()) {
    return [
      { key: `subject:${subjectHash}`, threshold: ACCOUNT_WIDE_FAILURE_THRESHOLD },
      ...factorKeys,
    ]
  }
  return [
    { key: `subject:${subjectHash}:${ipHash}`, threshold: 5 },
    { key: `subject:${subjectHash}`, threshold: ACCOUNT_WIDE_FAILURE_THRESHOLD },
    { key: `ip:${ipHash}`, threshold: IP_FAILURE_THRESHOLD },
    ...factorKeys,
  ]
}

export function loginIsBlocked(input: {
  factor?: LoginFactor
  ipHash: string
  subjectHash: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  return attemptKeys(input.subjectHash, input.ipHash, input.factor).some(({ key }) => {
    const row = database.select({ blockedUntil: authLoginAttempts.blockedUntil })
      .from(authLoginAttempts)
      .where(eq(authLoginAttempts.key, key))
      .get()
    return Boolean(row?.blockedUntil && row.blockedUntil > now)
  })
}

type AttemptTransaction = Parameters<Parameters<SmbaDatabase["transaction"]>[0]>[0]

type AttemptKey = { key: string, threshold: number }

function countAttempt(tx: AttemptTransaction, input: {
  factor?: LoginFactor
  ipHash: string
  subjectHash: string
}, now: Date) {
  countAttemptKeys(tx, attemptKeys(input.subjectHash, input.ipHash, input.factor), now)
}

function countAttemptKeys(tx: AttemptTransaction, keys: AttemptKey[], now: Date) {
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
  for (const { key, threshold } of keys) {
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
}

export function recordLoginFailure(input: {
  factor?: LoginFactor
  ipHash: string
  subjectHash: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  database.transaction((tx) => countAttempt(tx, input, now), { behavior: "immediate" })
}

/**
 * Checks the ceilings and spends one guess, as a single step.
 *
 * `loginIsBlocked` followed, after the slow verify, by `recordLoginFailure`
 * leaves the whole verify as a window: every request that arrives inside it
 * reads "not blocked" because none of the others has written its failure yet, so
 * a burst of simultaneous guesses all run and the ceiling only ever counts them
 * afterwards. Reserving first closes that -- the Nth concurrent request sees the
 * N-1 before it -- at the price that the caller must hand the guess back with
 * `releaseLoginAttempt` when the secret turns out to be right.
 *
 * Returns false, spending nothing, when a ceiling is already standing.
 */
export function reserveLoginAttempt(input: {
  factor?: LoginFactor
  ipHash: string
  subjectHash: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  return database.transaction((tx) => {
    const blocked = attemptKeys(input.subjectHash, input.ipHash, input.factor).some(({ key }) => {
      const row = tx.select({ blockedUntil: authLoginAttempts.blockedUntil })
        .from(authLoginAttempts)
        .where(eq(authLoginAttempts.key, key))
        .get()
      return Boolean(row?.blockedUntil && row.blockedUntil > now)
    })
    if (blocked) return false
    countAttempt(tx, input, now)
    return true
  }, { behavior: "immediate" })
}

/**
 * Hands back the guess `reserveLoginAttempt` spent, because it was the right
 * secret, and clears this account's failures as `recordLoginSuccess` does.
 *
 * The per-account keys are cleared outright. The per-address key is shared with
 * every other account that address has tried, so it is refunded by exactly one
 * rather than cleared -- otherwise one correct sign-in would forgive an address
 * that had just failed nineteen times elsewhere -- and a block that this very
 * reservation set is lifted again if the count has fallen back under its ceiling.
 */
export function releaseLoginAttempt(input: {
  factor?: LoginFactor
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
    recordLoginSuccess(input.subjectHash, { database: tx })
    // Only a verified PIN resets the PIN budget; see PIN_ACCOUNT_WIDE_FAILURE_THRESHOLD.
    // A right password must not hand a PIN guesser a fresh ten.
    if (input.factor === "pin") {
      tx.delete(authLoginAttempts)
        .where(eq(authLoginAttempts.key, `pin:${input.subjectHash}`))
        .run()
    }
    if (input.ipHash === unknownIpHash()) return
    const key = `ip:${input.ipHash}`
    const current = tx.select().from(authLoginAttempts)
      .where(eq(authLoginAttempts.key, key)).get()
    if (!current || now.getTime() - current.windowStartedAt.getTime() >= LOGIN_WINDOW_MS) return
    const failedCount = Math.max(0, current.failedCount - 1)
    const stillBlocked = failedCount >= IP_FAILURE_THRESHOLD ? current.blockedUntil : null
    tx.update(authLoginAttempts)
      .set({ blockedUntil: stillBlocked, failedCount, updatedAt: now })
      .where(eq(authLoginAttempts.key, key))
      .run()
  }, { behavior: "immediate" })
}

/*
 * Budgets for guessing an account's authenticator or recovery codes, spent
 * before every check.
 *
 * Better Auth's own eight-failure lockout counts only sign-in challenges, reads
 * its count before the slow check and writes it after, so parallel challenges
 * each saw "not locked". The in-session checks (finishing setup, reconnecting,
 * reissuing recovery codes, changing the recovery email) skipped it entirely,
 * and the `/two-factor/*` rate rules in better-auth.ts never run because no
 * Better Auth HTTP route is mounted. So the portal counts for itself: eight
 * failures a quarter-hour per account, reserved before the check exactly as PIN
 * sign-in reserves before its verify.
 *
 * Two budgets per account, not one, because the people who can spend them
 * differ:
 * - "challenge": checks made before the person is signed in -- the sign-in
 *   challenge and password recovery. Reaching one needs the account's password,
 *   its PIN, or its recovery inbox.
 * - "session": checks made inside a signed-in session. Reaching one needs a
 *   live session.
 * Sharing one budget let anyone holding only a coach's PIN fail eight sign-in
 * codes and lock the real coach, already signed in elsewhere, out of
 * reconnecting their authenticator or reissuing recovery codes. A right code in
 * either place proves the factor and clears both.
 */
const SECOND_FACTOR_FAILURE_THRESHOLD = 8

export type SecondFactorScope = "challenge" | "session"

function secondFactorKey(accountId: string, scope: SecondFactorScope): AttemptKey {
  return {
    key: `second_factor:${scope}:${authSubjectHash(`account:${accountId}`)}`,
    threshold: SECOND_FACTOR_FAILURE_THRESHOLD,
  }
}

/**
 * Checks one of this account's second-factor budgets and spends a guess from
 * it, as a single step. Returns false, spending nothing, when that budget is
 * already gone. Hand the guess back with `releaseSecondFactorAttempt` when the
 * code was right.
 */
export function reserveSecondFactorAttempt(accountId: string, scope: SecondFactorScope, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const keys = [secondFactorKey(accountId, scope)]
  return database.transaction((tx) => {
    const blocked = keys.some(({ key }) => {
      const row = tx.select({ blockedUntil: authLoginAttempts.blockedUntil })
        .from(authLoginAttempts)
        .where(eq(authLoginAttempts.key, key))
        .get()
      return Boolean(row?.blockedUntil && row.blockedUntil > now)
    })
    if (blocked) return false
    countAttemptKeys(tx, keys, now)
    return true
  }, { behavior: "immediate" })
}

/**
 * A right code -- or an owner-approved reset that removes the factor -- clears
 * both of the account's second-factor budgets.
 */
export function releaseSecondFactorAttempt(accountId: string, {
  database = initializeDatabase(),
}: {
  database?: SmbaDatabaseExecutor
} = {}) {
  for (const scope of ["challenge", "session"] as const) {
    database.delete(authLoginAttempts)
      .where(eq(authLoginAttempts.key, secondFactorKey(accountId, scope).key))
      .run()
  }
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
