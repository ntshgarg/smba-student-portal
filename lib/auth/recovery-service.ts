import "server-only"

import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto"

import { createOTP } from "@better-auth/utils/otp"
import { hashPassword, symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto"
import { and, desc, eq, gt, isNull, lte } from "drizzle-orm"

import { normalizeAcademyId } from "@/lib/auth/identity"
import { authEmailRequired, createAuthMailer, type AuthMailer } from "@/lib/auth/mailer"
import {
  loginIsBlocked,
  recordLoginFailure,
  recordLoginSuccess,
  validateNewPassword,
} from "@/lib/auth/credential-service"
import { authSubjectHash, writeAuthSecurityEvent } from "@/lib/auth/security-context"
import { absoluteSiteUrl } from "@/lib/config"
import {
  initializeDatabase,
  type SmbaDatabase,
  type SmbaDatabaseExecutor,
} from "@/lib/db/client"
import {
  accounts,
  authAccessCodes,
  authAuthenticatorResetRequests,
  authCredentialStates,
  authEmailChallenges,
  authMethods,
  authPinCredentials,
  authProviderAccounts,
  authRecoveryEmails,
  authRuntimeSessions,
  authSessions,
  authTwoFactors,
  authUsers,
  coachProfiles,
} from "@/lib/db/schema"

export const RECOVERY_SESSION_COOKIE = "smba_password_recovery"
export const AUTHENTICATOR_RECOVERY_COOKIE = "smba_authenticator_recovery"
export const HEAD_SETUP_EMAIL_COOKIE = "smba_head_setup_email"
export const EMAIL_VERIFICATION_LIFETIME_MS = 10 * 60 * 1000
export const PASSWORD_RECOVERY_LIFETIME_MS = 20 * 60 * 1000
const AUTHENTICATOR_RESET_REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1000
export const EMAIL_RESEND_COOLDOWN_MS = 60 * 1000
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5

const EMAIL_REQUEST_WINDOW_MS = 15 * 60 * 1000
const EMAIL_REQUEST_LIMIT = 3
const SECOND_FACTOR_FAILURE_LIMIT = 8
const SECOND_FACTOR_LOCK_MS = 15 * 60 * 1000

type SecurityMetadata = {
  ipHash?: string | null
  userAgent?: string | null
}

function recoverySecret() {
  return process.env.BETTER_AUTH_SECRET?.trim()
    || "smba-local-only-recovery-secret-change-before-deployment-2026"
}

function digest(label: string, value: string) {
  return createHmac("sha256", recoverySecret())
    .update(`${label}:${value}`)
    .digest("hex")
}

function equalDigest(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex")
  const rightBuffer = Buffer.from(right, "hex")
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function normalizeRecoveryEmail(value: string) {
  const normalized = value.trim().toLocaleLowerCase("en-US")
  if (normalized.length < 3 || normalized.length > 254) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) return null
  return normalized
}

export function maskRecoveryEmail(value: string) {
  const [local = "", domain = ""] = value.split("@")
  const visibleLocal = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2)
  return `${visibleLocal}${"•".repeat(Math.max(3, local.length - visibleLocal.length))}@${domain}`
}

export function recoverySubjectKeyForAccount(accountId: string) {
  return `account:${accountId}`
}

export function recoverySubjectKeyForHeadSetup(setupToken: string) {
  return `head-setup:${digest("head-setup-token", setupToken.trim())}`
}

function subjectHash(subjectKey: string) {
  return digest("recovery-subject", subjectKey)
}

function challengeSecretHash(
  purpose: "password_reset" | "verify_email",
  subject: string,
  challengeId: string,
  value: string,
) {
  return digest(`email-${purpose}`, `${subject}:${challengeId}:${value.trim()}`)
}

function requestThrottleKeys(subject: string, ipHash?: string | null) {
  return {
    ipHash: ipHash ?? authSubjectHash("recovery-request:unknown-ip"),
    subjectHash: authSubjectHash(subject),
  }
}

async function genericRecoveryResponse(startedAt: number) {
  const responseFloorMs = 100 + randomInt(0, 51)
  const remainingMs = responseFloorMs - (Date.now() - startedAt)
  if (remainingMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingMs))
  }
  return { accepted: true as const }
}

export function getRecoveryEmail(accountId: string, {
  database = initializeDatabase(),
}: {
  database?: SmbaDatabaseExecutor
} = {}) {
  return database.select({
    createdAt: authRecoveryEmails.createdAt,
    email: authRecoveryEmails.email,
    verifiedAt: authRecoveryEmails.verifiedAt,
  }).from(authRecoveryEmails)
    .where(eq(authRecoveryEmails.accountId, accountId))
    .get() ?? null
}

export function hasVerifiedRecoveryEmail(accountId: string, options?: {
  database?: SmbaDatabaseExecutor
}) {
  return Boolean(getRecoveryEmail(accountId, options)?.verifiedAt)
}

export function recoveryEmailEnrollmentRequired(accountId: string, options?: {
  database?: SmbaDatabaseExecutor
}) {
  return authEmailRequired() && !hasVerifiedRecoveryEmail(accountId, options)
}

function accountName(accountId: string, database: SmbaDatabaseExecutor) {
  return database.select({ fullName: accounts.fullName })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get()?.fullName ?? null
}

export async function requestRecoveryEmailVerification(input: {
  accountId?: string
  email: string
  fullName?: string
  mailer?: AuthMailer
  security?: SecurityMetadata
  subjectKey: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const email = normalizeRecoveryEmail(input.email)
  if (!email) throw new Error("Enter a valid recovery email address.")
  const fullName = input.accountId
    ? accountName(input.accountId, database)
    : input.fullName?.trim()
  if (!fullName) throw new Error("This account is unavailable.")
  const hashedSubject = subjectHash(input.subjectKey)
  const attempt = requestThrottleKeys(
    `recovery-email-send:${hashedSubject}`,
    input.security?.ipHash,
  )
  if (loginIsBlocked(attempt, { database, now })) {
    writeAuthSecurityEvent({
      accountId: input.accountId,
      eventType: "recovery_email_verification_requested",
      ipHash: input.security?.ipHash,
      outcome: "blocked",
      userAgent: input.security?.userAgent,
    }, { database, now })
    throw new Error("Wait a few minutes before requesting another code.")
  }
  const latest = database.select({ createdAt: authEmailChallenges.createdAt })
    .from(authEmailChallenges)
    .where(and(
      eq(authEmailChallenges.subjectHash, hashedSubject),
      eq(authEmailChallenges.purpose, "verify_email"),
      isNull(authEmailChallenges.consumedAt),
    ))
    .orderBy(desc(authEmailChallenges.createdAt))
    .get()
  if (latest && now.getTime() - latest.createdAt.getTime() < EMAIL_RESEND_COOLDOWN_MS) {
    throw new Error("Wait one minute before requesting another code.")
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
  const challengeId = randomUUID()
  recordLoginFailure(attempt, { database, now })
  database.transaction((tx) => {
    tx.update(authEmailChallenges).set({ consumedAt: now, updatedAt: now })
      .where(and(
        eq(authEmailChallenges.subjectHash, hashedSubject),
        eq(authEmailChallenges.purpose, "verify_email"),
        isNull(authEmailChallenges.consumedAt),
      )).run()
    tx.insert(authEmailChallenges).values({
      id: challengeId,
      accountId: input.accountId ?? null,
      subjectHash: hashedSubject,
      purpose: "verify_email",
      email,
      secretHash: challengeSecretHash("verify_email", hashedSubject, challengeId, code),
      expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_LIFETIME_MS),
      createdAt: now,
      updatedAt: now,
    }).run()
  }, { behavior: "immediate" })

  try {
    await (input.mailer ?? createAuthMailer()).sendRecoveryEmailVerification({
      code,
      expiresInMinutes: EMAIL_VERIFICATION_LIFETIME_MS / 60_000,
      fullName,
      to: email,
    })
    recordLoginSuccess(requestThrottleKeys(
      `recovery-email-code:${hashedSubject}`,
      input.security?.ipHash,
    ).subjectHash, { database })
  } catch (error) {
    database.update(authEmailChallenges).set({ consumedAt: now, updatedAt: now })
      .where(eq(authEmailChallenges.id, challengeId)).run()
    writeAuthSecurityEvent({
      accountId: input.accountId,
      eventType: "recovery_email_verification_requested",
      ipHash: input.security?.ipHash,
      metadata: { reason: "email_delivery" },
      outcome: "failure",
      subjectHash: hashedSubject,
      userAgent: input.security?.userAgent,
    }, { database, now })
    throw error
  }

  if (input.accountId) {
    writeAuthSecurityEvent({
      accountId: input.accountId,
      eventType: "recovery_email_verification_requested",
      ipHash: input.security?.ipHash,
      outcome: "success",
      userAgent: input.security?.userAgent,
    }, { database, now })
  }
  return { challengeId, email }
}

export function confirmRecoveryEmailVerification(input: {
  accountId?: string
  code: string
  email: string
  security?: SecurityMetadata
  subjectKey: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const email = normalizeRecoveryEmail(input.email)
  const hashedSubject = subjectHash(input.subjectKey)
  const attempt = requestThrottleKeys(
    `recovery-email-code:${hashedSubject}`,
    input.security?.ipHash,
  )
  if (!email || !/^\d{6}$/u.test(input.code)) return null
  if (loginIsBlocked(attempt, { database, now })) return null
  const challenge = database.select().from(authEmailChallenges)
    .where(and(
      eq(authEmailChallenges.subjectHash, hashedSubject),
      eq(authEmailChallenges.purpose, "verify_email"),
      eq(authEmailChallenges.email, email),
      isNull(authEmailChallenges.consumedAt),
      gt(authEmailChallenges.expiresAt, now),
    ))
    .orderBy(desc(authEmailChallenges.createdAt))
    .get()
  if (!challenge || challenge.failedAttempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) return null
  const suppliedHash = challengeSecretHash(
    "verify_email",
    hashedSubject,
    challenge.id,
    input.code,
  )
  if (!equalDigest(challenge.secretHash, suppliedHash)) {
    const failedAttempts = challenge.failedAttempts + 1
    database.update(authEmailChallenges).set({
      failedAttempts,
      consumedAt: failedAttempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS ? now : null,
      updatedAt: now,
    }).where(eq(authEmailChallenges.id, challenge.id)).run()
    recordLoginFailure(attempt, { database, now })
    return null
  }

  recordLoginSuccess(attempt.subjectHash, { database })

  if (input.accountId) {
    const existing = getRecoveryEmail(input.accountId, { database })
    database.transaction((tx) => {
      tx.insert(authRecoveryEmails).values({
        accountId: input.accountId!,
        email,
        verifiedAt: now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: authRecoveryEmails.accountId,
        set: { email, verifiedAt: now, updatedAt: now },
      }).run()
      tx.update(authEmailChallenges).set({
        consumedAt: now,
        verifiedAt: now,
        updatedAt: now,
      }).where(eq(authEmailChallenges.id, challenge.id)).run()
      writeAuthSecurityEvent({
        accountId: input.accountId,
        eventType: existing ? "recovery_email_changed" : "recovery_email_verified",
        ipHash: input.security?.ipHash,
        outcome: "success",
        userAgent: input.security?.userAgent,
      }, { database: tx, now })
    }, { behavior: "immediate" })
    return { email, receiptToken: null }
  }

  const receiptToken = randomBytes(32).toString("base64url")
  database.update(authEmailChallenges).set({
    failedAttempts: 0,
    secretHash: challengeSecretHash(
      "verify_email",
      hashedSubject,
      challenge.id,
      receiptToken,
    ),
    verifiedAt: now,
    updatedAt: now,
  }).where(eq(authEmailChallenges.id, challenge.id)).run()
  return { email, receiptToken }
}

export function consumeVerifiedSetupRecoveryEmail(input: {
  accountId: string
  receiptToken: string
  subjectKey: string
}, {
  database,
  now = new Date(),
}: {
  database: SmbaDatabaseExecutor
  now?: Date
}) {
  const hashedSubject = subjectHash(input.subjectKey)
  const challenges = database.select().from(authEmailChallenges)
    .where(and(
      eq(authEmailChallenges.subjectHash, hashedSubject),
      eq(authEmailChallenges.purpose, "verify_email"),
      isNull(authEmailChallenges.consumedAt),
      gt(authEmailChallenges.expiresAt, now),
    )).all()
  const challenge = challenges.find((candidate) => equalDigest(
    candidate.secretHash,
    challengeSecretHash("verify_email", hashedSubject, candidate.id, input.receiptToken),
  ))
  if (!challenge?.verifiedAt) return null
  database.insert(authRecoveryEmails).values({
    accountId: input.accountId,
    email: challenge.email,
    verifiedAt: challenge.verifiedAt,
    createdAt: now,
    updatedAt: now,
  }).run()
  database.update(authEmailChallenges).set({ consumedAt: now, updatedAt: now })
    .where(eq(authEmailChallenges.id, challenge.id)).run()
  return challenge.email
}

export function getVerifiedSetupRecoveryEmail(input: {
  receiptToken: string | null | undefined
  subjectKey: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  if (!input.receiptToken) return null
  const hashedSubject = subjectHash(input.subjectKey)
  const challenges = database.select({
    email: authEmailChallenges.email,
    id: authEmailChallenges.id,
    secretHash: authEmailChallenges.secretHash,
    verifiedAt: authEmailChallenges.verifiedAt,
  }).from(authEmailChallenges).where(and(
    eq(authEmailChallenges.subjectHash, hashedSubject),
    eq(authEmailChallenges.purpose, "verify_email"),
    isNull(authEmailChallenges.consumedAt),
    gt(authEmailChallenges.expiresAt, now),
  )).all()
  const challenge = challenges.find((candidate) => equalDigest(
    candidate.secretHash,
    challengeSecretHash("verify_email", hashedSubject, candidate.id, input.receiptToken!),
  ))
  return challenge?.verifiedAt ? challenge.email : null
}

export async function requestPasswordRecovery(input: {
  academyId: string
  email: string
  intent?: "authenticator" | "password"
  mailer?: AuthMailer
  security?: SecurityMetadata
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const startedAt = Date.now()
  const intent = input.intent ?? "password"
  const failureEvent = intent === "authenticator" ? "totp_reset_failed" : "password_recovery_failed"
  const academyId = normalizeAcademyId(input.academyId)
  const email = normalizeRecoveryEmail(input.email)
  // Perform the same keyed hashing for every request before deciding whether a
  // matching account exists. The public response remains intentionally generic.
  const publicSubject = authSubjectHash(`${academyId}:${email ?? input.email.trim()}`)
  const attempt = requestThrottleKeys(
    `${intent}-recovery:${publicSubject}`,
    input.security?.ipHash,
  )
  if (loginIsBlocked(attempt, { database, now })) {
    writeAuthSecurityEvent({
      eventType: failureEvent,
      ipHash: input.security?.ipHash,
      outcome: "blocked",
      subjectHash: publicSubject,
      userAgent: input.security?.userAgent,
    }, { database, now })
    return genericRecoveryResponse(startedAt)
  }
  recordLoginFailure(attempt, { database, now })
  if (!email) {
    writeAuthSecurityEvent({
      eventType: failureEvent,
      ipHash: input.security?.ipHash,
      outcome: "failure",
      subjectHash: publicSubject,
      userAgent: input.security?.userAgent,
    }, { database, now })
    return genericRecoveryResponse(startedAt)
  }
  const account = database.select({
    accessLevel: coachProfiles.accessLevel,
    accountId: accounts.id,
    fullName: accounts.fullName,
    role: accounts.role,
    twoFactorEnabled: authUsers.twoFactorEnabled,
  }).from(authMethods)
    .innerJoin(accounts, eq(accounts.id, authMethods.accountId))
    .innerJoin(authUsers, eq(authUsers.id, accounts.id))
    .innerJoin(authCredentialStates, and(
      eq(authCredentialStates.accountId, accounts.id),
      eq(authCredentialStates.status, "active"),
    ))
    .innerJoin(authRecoveryEmails, and(
      eq(authRecoveryEmails.accountId, accounts.id),
      eq(authRecoveryEmails.email, email),
    ))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(and(
      eq(authMethods.identifier, academyId),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    )).get()
  const validAuthenticatorRecovery = intent !== "authenticator"
    || (account?.role === "coach"
      && account.accessLevel === "head_admin"
      && account.twoFactorEnabled)
  if (!account || !validAuthenticatorRecovery) {
    writeAuthSecurityEvent({
      eventType: failureEvent,
      ipHash: input.security?.ipHash,
      outcome: "failure",
      subjectHash: publicSubject,
      userAgent: input.security?.userAgent,
    }, { database, now })
    return genericRecoveryResponse(startedAt)
  }

  const hashedSubject = subjectHash(recoverySubjectKeyForAccount(account.accountId))
  const recent = database.select({ id: authEmailChallenges.id })
    .from(authEmailChallenges)
    .where(and(
      eq(authEmailChallenges.accountId, account.accountId),
      eq(authEmailChallenges.purpose, "password_reset"),
      gt(authEmailChallenges.createdAt, new Date(now.getTime() - EMAIL_REQUEST_WINDOW_MS)),
    )).all()
  if (recent.length >= EMAIL_REQUEST_LIMIT) {
    writeAuthSecurityEvent({
      accountId: account.accountId,
      eventType: failureEvent,
      ipHash: input.security?.ipHash,
      outcome: "blocked",
      subjectHash: publicSubject,
      userAgent: input.security?.userAgent,
    }, { database, now })
    return genericRecoveryResponse(startedAt)
  }

  const token = randomBytes(32).toString("base64url")
  const challengeId = randomUUID()
  database.transaction((tx) => {
    tx.update(authEmailChallenges).set({ consumedAt: now, updatedAt: now })
      .where(and(
        eq(authEmailChallenges.accountId, account.accountId),
        eq(authEmailChallenges.purpose, "password_reset"),
        isNull(authEmailChallenges.consumedAt),
      )).run()
    tx.insert(authEmailChallenges).values({
      id: challengeId,
      accountId: account.accountId,
      subjectHash: hashedSubject,
      purpose: "password_reset",
      email,
      secretHash: challengeSecretHash("password_reset", hashedSubject, challengeId, token),
      expiresAt: new Date(now.getTime() + PASSWORD_RECOVERY_LIFETIME_MS),
      createdAt: now,
      updatedAt: now,
    }).run()
  }, { behavior: "immediate" })

  try {
    const mailer = input.mailer ?? createAuthMailer()
    if (intent === "authenticator") {
      await mailer.sendAuthenticatorRecovery({
        expiresInMinutes: PASSWORD_RECOVERY_LIFETIME_MS / 60_000,
        fullName: account.fullName,
        recoveryUrl: absoluteSiteUrl(`/auth/two-factor/recovery/claim?token=${encodeURIComponent(token)}`),
        to: email,
      })
    } else {
      await mailer.sendPasswordRecovery({
        expiresInMinutes: PASSWORD_RECOVERY_LIFETIME_MS / 60_000,
        fullName: account.fullName,
        resetUrl: absoluteSiteUrl(`/recover/claim?token=${encodeURIComponent(token)}`),
        to: email,
      })
    }
    writeAuthSecurityEvent({
      accountId: account.accountId,
      eventType: intent === "authenticator" ? "totp_recovery_email_sent" : "password_recovery_requested",
      ipHash: input.security?.ipHash,
      outcome: "success",
      subjectHash: publicSubject,
      userAgent: input.security?.userAgent,
    }, { database, now })
  } catch {
    database.update(authEmailChallenges).set({ consumedAt: now, updatedAt: now })
      .where(eq(authEmailChallenges.id, challengeId)).run()
    writeAuthSecurityEvent({
      accountId: account.accountId,
      eventType: failureEvent,
      ipHash: input.security?.ipHash,
      metadata: { reason: "email_delivery" },
      outcome: "failure",
      subjectHash: publicSubject,
      userAgent: input.security?.userAgent,
    }, { database, now })
  }
  return genericRecoveryResponse(startedAt)
}

function recoveryChallenge(token: string, database: SmbaDatabaseExecutor, now: Date) {
  if (!/^[A-Za-z0-9_-]{40,}$/u.test(token)) return null
  const rows = database.select({
    accessLevel: coachProfiles.accessLevel,
    accountId: authEmailChallenges.accountId,
    academyId: authMethods.identifier,
    challengeId: authEmailChallenges.id,
    claimedAt: authEmailChallenges.claimedAt,
    consumedAt: authEmailChallenges.consumedAt,
    email: authEmailChallenges.email,
    expiresAt: authEmailChallenges.expiresAt,
    role: accounts.role,
    secondFactorVerifiedAt: authEmailChallenges.secondFactorVerifiedAt,
    secretHash: authEmailChallenges.secretHash,
    twoFactorEnabled: authUsers.twoFactorEnabled,
  }).from(authEmailChallenges)
    .innerJoin(accounts, eq(accounts.id, authEmailChallenges.accountId))
    .innerJoin(authMethods, and(
      eq(authMethods.accountId, accounts.id),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
    ))
    .innerJoin(authUsers, eq(authUsers.id, accounts.id))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(and(
      eq(authEmailChallenges.purpose, "password_reset"),
      isNull(authEmailChallenges.consumedAt),
      gt(authEmailChallenges.expiresAt, now),
      eq(accounts.approvalStatus, "approved"),
      isNull(accounts.archivedAt),
    )).all()
  for (const row of rows) {
    const hashedSubject = subjectHash(recoverySubjectKeyForAccount(row.accountId!))
    const suppliedHash = challengeSecretHash("password_reset", hashedSubject, row.challengeId, token)
    if (equalDigest(row.secretHash, suppliedHash)) return row
  }
  return null
}

function roleRequiresRecoverySecondFactor(row: {
  accessLevel: "head_admin" | "junior_coach" | null
  role: "coach" | "platform_admin" | "player" | null
}) {
  return row.role === "platform_admin"
    || (row.role === "coach" && row.accessLevel === "head_admin")
}

export function claimPasswordRecovery(token: string, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  const challenge = recoveryChallenge(token, database, now)
  if (!challenge || challenge.claimedAt) return false
  return database.update(authEmailChallenges).set({ claimedAt: now, updatedAt: now })
    .where(and(
      eq(authEmailChallenges.id, challenge.challengeId),
      isNull(authEmailChallenges.claimedAt),
      isNull(authEmailChallenges.consumedAt),
      gt(authEmailChallenges.expiresAt, now),
    )).run().changes === 1
}

export type PasswordRecoveryStatus =
  | { state: "missing" }
  | {
    academyId: string
    requiresSecondFactor: boolean
    secondFactorVerified: boolean
    state: "active"
  }

export function getPasswordRecoveryStatus(token: string, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}): PasswordRecoveryStatus {
  const challenge = recoveryChallenge(token, database, now)
  if (!challenge?.claimedAt || !challenge.role) return { state: "missing" }
  const requiresSecondFactor = roleRequiresRecoverySecondFactor(challenge)
  return {
    academyId: challenge.academyId,
    requiresSecondFactor,
    secondFactorVerified: !requiresSecondFactor || Boolean(challenge.secondFactorVerifiedAt),
    state: "active",
  }
}

export type AuthenticatorRecoveryStatus =
  | { state: "missing" }
  | { academyId: string; state: "verified" }

export function getAuthenticatorRecoveryStatus(token: string, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}): AuthenticatorRecoveryStatus {
  const challenge = recoveryChallenge(token, database, now)
  if (!challenge?.accountId
    || !challenge.claimedAt
    || challenge.role !== "coach"
    || challenge.accessLevel !== "head_admin"
    || !challenge.twoFactorEnabled) {
    return { state: "missing" }
  }
  const recoveryEmail = getRecoveryEmail(challenge.accountId, { database })
  if (!recoveryEmail || recoveryEmail.email !== challenge.email) return { state: "missing" }
  return { academyId: challenge.academyId, state: "verified" }
}

export function submitAuthenticatorResetRequest(input: {
  security?: SecurityMetadata
  token: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const challenge = recoveryChallenge(input.token, database, now)
  if (!challenge?.accountId
    || !challenge.claimedAt
    || challenge.role !== "coach"
    || challenge.accessLevel !== "head_admin"
    || !challenge.twoFactorEnabled) {
    return null
  }
  const accountId = challenge.accountId
  const recoveryEmail = getRecoveryEmail(accountId, { database })
  if (!recoveryEmail || recoveryEmail.email !== challenge.email) return null
  const expiresAt = new Date(now.getTime() + AUTHENTICATOR_RESET_REQUEST_LIFETIME_MS)

  return database.transaction((tx) => {
    const activeChallenge = tx.select({ id: authEmailChallenges.id })
      .from(authEmailChallenges)
      .where(and(
        eq(authEmailChallenges.id, challenge.challengeId),
        isNull(authEmailChallenges.consumedAt),
        gt(authEmailChallenges.expiresAt, now),
      )).get()
    if (!activeChallenge) return null

    tx.update(authAuthenticatorResetRequests).set({
      resolvedAt: now,
      status: "expired",
      updatedAt: now,
    }).where(and(
      eq(authAuthenticatorResetRequests.accountId, accountId),
      eq(authAuthenticatorResetRequests.status, "pending"),
      lte(authAuthenticatorResetRequests.expiresAt, now),
    )).run()

    const pending = tx.select({ id: authAuthenticatorResetRequests.id })
      .from(authAuthenticatorResetRequests)
      .where(and(
        eq(authAuthenticatorResetRequests.accountId, accountId),
        eq(authAuthenticatorResetRequests.status, "pending"),
        gt(authAuthenticatorResetRequests.expiresAt, now),
      )).get()
    const requestId = pending?.id ?? randomUUID()
    if (pending) {
      tx.update(authAuthenticatorResetRequests).set({
        expiresAt,
        recoveryEmail: recoveryEmail.email,
        requestedAt: now,
        updatedAt: now,
      }).where(eq(authAuthenticatorResetRequests.id, requestId)).run()
    } else {
      tx.insert(authAuthenticatorResetRequests).values({
        accountId,
        createdAt: now,
        expiresAt,
        id: requestId,
        recoveryEmail: recoveryEmail.email,
        requestedAt: now,
        status: "pending",
        updatedAt: now,
      }).run()
    }
    tx.update(authEmailChallenges).set({ consumedAt: now, updatedAt: now })
      .where(eq(authEmailChallenges.id, challenge.challengeId)).run()
    writeAuthSecurityEvent({
      accountId,
      eventType: "totp_reset_requested",
      ipHash: input.security?.ipHash,
      metadata: { requestId },
      outcome: "success",
      userAgent: input.security?.userAgent,
    }, { database: tx, now })
    return { accountId, requestId }
  }, { behavior: "immediate" })
}

async function verifyAccountSecondFactor(input: {
  accountId: string
  credential: string
}, {
  database,
  now,
}: {
  database: SmbaDatabase
  now: Date
}) {
  const factor = database.select().from(authTwoFactors)
    .where(eq(authTwoFactors.userId, input.accountId)).get()
  if (!factor?.verified) return false
  if (factor.lockedUntil && factor.lockedUntil > now) return false

  let valid = false
  let updatedBackupCodes: string | null = null
  try {
    if (/^\d{6}$/u.test(input.credential)) {
      const secret = await symmetricDecrypt({ data: factor.secret, key: recoverySecret() })
      valid = await createOTP(secret).verify(input.credential)
    } else {
      const decoded = await symmetricDecrypt({ data: factor.backupCodes, key: recoverySecret() })
      const codes = JSON.parse(decoded) as string[]
      valid = codes.includes(input.credential.trim())
      if (valid) {
        updatedBackupCodes = await symmetricEncrypt({
          data: JSON.stringify(codes.filter((code) => code !== input.credential.trim())),
          key: recoverySecret(),
        })
      }
    }
  } catch {
    valid = false
  }

  if (!valid) {
    const failedVerificationCount = factor.failedVerificationCount + 1
    database.update(authTwoFactors).set({
      failedVerificationCount,
      lockedUntil: failedVerificationCount >= SECOND_FACTOR_FAILURE_LIMIT
        ? new Date(now.getTime() + SECOND_FACTOR_LOCK_MS)
        : null,
    }).where(eq(authTwoFactors.id, factor.id)).run()
    return false
  }

  const update = updatedBackupCodes
    ? database.update(authTwoFactors).set({
      backupCodes: updatedBackupCodes,
      failedVerificationCount: 0,
      lockedUntil: null,
    }).where(and(
      eq(authTwoFactors.id, factor.id),
      eq(authTwoFactors.backupCodes, factor.backupCodes),
    )).run()
    : database.update(authTwoFactors).set({
      failedVerificationCount: 0,
      lockedUntil: null,
    }).where(eq(authTwoFactors.id, factor.id)).run()
  return update.changes === 1
}

export async function verifyPasswordRecoverySecondFactor(input: {
  credential: string
  security?: SecurityMetadata
  token: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const challenge = recoveryChallenge(input.token, database, now)
  if (!challenge?.accountId || !challenge.claimedAt || !roleRequiresRecoverySecondFactor(challenge)) {
    return false
  }
  const attempt = requestThrottleKeys(
    `recovery-factor:${challenge.accountId}`,
    input.security?.ipHash,
  )
  if (loginIsBlocked(attempt, { database, now })) {
    writeAuthSecurityEvent({
      accountId: challenge.accountId,
      eventType: "password_recovery_failed",
      ipHash: input.security?.ipHash,
      outcome: "blocked",
      userAgent: input.security?.userAgent,
    }, { database, now })
    return false
  }
  const valid = await verifyAccountSecondFactor({
    accountId: challenge.accountId,
    credential: input.credential,
  }, { database, now })
  if (!valid) {
    recordLoginFailure(attempt, { database, now })
    writeAuthSecurityEvent({
      accountId: challenge.accountId,
      eventType: "password_recovery_failed",
      ipHash: input.security?.ipHash,
      outcome: "failure",
      userAgent: input.security?.userAgent,
    }, { database, now })
    return false
  }
  recordLoginSuccess(attempt.subjectHash, { database })
  database.update(authEmailChallenges).set({
    secondFactorVerifiedAt: now,
    updatedAt: now,
  }).where(eq(authEmailChallenges.id, challenge.challengeId)).run()
  writeAuthSecurityEvent({
    accountId: challenge.accountId,
    eventType: "password_recovery_second_factor_verified",
    ipHash: input.security?.ipHash,
    outcome: "success",
    userAgent: input.security?.userAgent,
  }, { database, now })
  return true
}

export async function verifyFreshAccountSecondFactor(input: {
  accountId: string
  credential: string
  security?: SecurityMetadata
}, options?: {
  database?: SmbaDatabase
  now?: Date
}) {
  const database = options?.database ?? initializeDatabase()
  const now = options?.now ?? new Date()
  const attempt = requestThrottleKeys(
    `fresh-account-factor:${input.accountId}`,
    input.security?.ipHash,
  )
  if (loginIsBlocked(attempt, { database, now })) return false
  const valid = await verifyAccountSecondFactor(input, { database, now })
  if (!valid) {
    recordLoginFailure(attempt, { database, now })
    return false
  }
  recordLoginSuccess(attempt.subjectHash, { database })
  return true
}

export async function completePasswordRecovery(input: {
  password: string
  security?: SecurityMetadata
  token: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  if (validateNewPassword(input.password)) return false
  const challenge = recoveryChallenge(input.token, database, now)
  if (!challenge?.accountId || !challenge.claimedAt || !challenge.role) return false
  if (roleRequiresRecoverySecondFactor(challenge) && !challenge.secondFactorVerifiedAt) return false
  const passwordHash = await hashPassword(input.password)

  return database.transaction((tx) => {
    const current = tx.select({ id: authEmailChallenges.id })
      .from(authEmailChallenges)
      .where(and(
        eq(authEmailChallenges.id, challenge.challengeId),
        isNull(authEmailChallenges.consumedAt),
        gt(authEmailChallenges.expiresAt, now),
      )).get()
    if (!current) return false
    const updatedPassword = tx.update(authProviderAccounts)
      .set({ password: passwordHash, updatedAt: now })
      .where(and(
        eq(authProviderAccounts.userId, challenge.accountId!),
        eq(authProviderAccounts.providerId, "credential"),
      )).run()
    if (updatedPassword.changes !== 1) return false
    tx.update(authCredentialStates).set({
      passwordChangedAt: now,
      status: "active",
      updatedAt: now,
    }).where(eq(authCredentialStates.accountId, challenge.accountId!)).run()
    const removedPin = tx.delete(authPinCredentials)
      .where(eq(authPinCredentials.accountId, challenge.accountId!)).run().changes > 0
    tx.delete(authRuntimeSessions).where(eq(authRuntimeSessions.userId, challenge.accountId!)).run()
    tx.delete(authSessions).where(eq(authSessions.accountId, challenge.accountId!)).run()
    tx.update(authEmailChallenges).set({ consumedAt: now, updatedAt: now })
      .where(and(
        eq(authEmailChallenges.accountId, challenge.accountId!),
        eq(authEmailChallenges.purpose, "password_reset"),
        isNull(authEmailChallenges.consumedAt),
      )).run()
    tx.update(authAccessCodes).set({ consumedAt: now })
      .where(and(
        eq(authAccessCodes.accountId, challenge.accountId!),
        eq(authAccessCodes.purpose, "password_reset"),
        isNull(authAccessCodes.consumedAt),
      )).run()
    if (removedPin) {
      writeAuthSecurityEvent({
        accountId: challenge.accountId,
        actorAccountId: challenge.accountId,
        eventType: "pin_removed",
        outcome: "success",
      }, { database: tx, now })
    }
    writeAuthSecurityEvent({
      accountId: challenge.accountId,
      eventType: "password_reset_completed",
      ipHash: input.security?.ipHash,
      outcome: "success",
      subjectHash: authSubjectHash(challenge.academyId),
      userAgent: input.security?.userAgent,
    }, { database: tx, now })
    writeAuthSecurityEvent({
      accountId: challenge.accountId,
      actorAccountId: challenge.accountId,
      eventType: "sessions_revoked",
      metadata: { scope: "all_devices", reason: "password_recovery" },
      outcome: "success",
    }, { database: tx, now })
    return true
  }, { behavior: "immediate" })
}
