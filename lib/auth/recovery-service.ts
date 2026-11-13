import "server-only"

import { resolveAuthSecret } from "@/lib/auth/auth-secret"
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto"

import { createOTP } from "@better-auth/utils/otp"
import { hashPassword, symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto"
import { and, desc, eq, gt, isNull, lt, lte, ne, sql } from "drizzle-orm"

import { normalizeAcademyId } from "@/lib/auth/identity"
import { authEmailRequired, createAuthMailer, type AuthMailer } from "@/lib/auth/mailer"
import {
  clearSignInPauses,
  loginIsBlocked,
  recordLoginFailure,
  recordLoginSuccess,
  releaseLoginAttempt,
  releaseSecondFactorAttempt,
  reserveLoginAttempt,
  reserveSecondFactorAttempt,
  type SecondFactorScope,
  validateNewPassword,
} from "@/lib/auth/credential-service"
import {
  authSubjectHash,
  unknownIpHash,
  writeAuthSecurityEvent,
} from "@/lib/auth/security-context"
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
/** How long a verified setup email stays usable, counted from verification. */
export const HEAD_SETUP_VERIFIED_EMAIL_LIFETIME_MS = 30 * 60 * 1000
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
  return resolveAuthSecret("smba-local-only-recovery-secret-change-before-deployment-2026")
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

/**
 * One normaliser for every address the product compares, so a recovery address
 * and a registration contact address can never disagree about what "the same
 * inbox" means.
 *
 * Case and surrounding space are folded, and NFKC collapses the byte
 * representations that render identically. Gmail's dots and `+tags` are
 * deliberately NOT stripped. Both directions fail, but not symmetrically:
 * over-normalising merges two genuinely distinct addresses at a provider that
 * does not alias them, and locks a real family out with no route forward, while
 * under-normalising only lets someone hold `a+1@` and `a+2@` -- which the coach
 * reviewing every request sees. Fold Gmail specifically if deliberate abuse ever
 * shows up; until then the quieter failure is the right one.
 */
export function normalizeEmailAddress(value: string) {
  const normalized = value.trim().normalize("NFKC").toLocaleLowerCase("en-US")
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

/**
 * A registration has no account to key against -- that is the whole point, since
 * the row is only written once the code is confirmed -- so the subject is the
 * identity itself: the normalised contact address and the normalised name.
 *
 * One address may own several players and the name separates them, so the pair
 * is the key rather than the address alone. Both halves arrive already
 * normalised; hashing raw input here would let " Arjun " and "arjun" open two
 * challenges for one person.
 */
export function registrationSubjectKey(normalizedEmail: string, normalizedName: string) {
  return `registration:${digest("registration-identity", `${normalizedEmail} ${normalizedName}`)}`
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

/*
 * The address half is namespaced as well as the subject half, and that matters
 * more than it looks. `attemptKeys` writes `ip:<hash>` from whatever it is
 * handed, and the sign-in paths hand it the raw hash from `requestSecurityContext`
 * -- so passing the raw hash through here put every unauthenticated recovery and
 * registration request into the same twenty-per-fifteen-minutes bucket that
 * governs whether anyone behind that address can sign in at all. Ten sends from
 * an academy's wifi, or from a carrier NAT, locked out every unrelated person on
 * it. A registration flood should throttle registration and nothing else.
 */
// Sends and code checks use separate address buckets. With no visible address, the address half is scoped
// to the subject, so strangers never share one global bucket.
type RequestBucket = "recovery-code" | "recovery-request"

function requestThrottleKeys(
  subject: string,
  ipHash?: string | null,
  bucket: RequestBucket = "recovery-request",
) {
  const addressUnknown = !ipHash || ipHash === unknownIpHash()
  return {
    ipHash: authSubjectHash(addressUnknown
      ? `${bucket}:unknown-address:${subject}`
      : `${bucket}:${ipHash}`),
    subjectHash: authSubjectHash(subject),
  }
}

function recoveryEmailCodeAttempt(hashedSubject: string, ipHash?: string | null) {
  return requestThrottleKeys(`recovery-email-code:${hashedSubject}`, ipHash, "recovery-code")
}

function registrationCodeAttempt(hashedSubject: string, ipHash?: string | null) {
  return requestThrottleKeys(
    `registration-code:${hashedSubject}:${authSubjectHash(ipHash ?? "unknown-ip")}`,
    ipHash,
    "recovery-code",
  )
}

/** Whether registration code checks are paused from this address. Read-only. */
export function emailCodeChecksPaused(input: {
  security?: SecurityMetadata
  subjectKey: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  return loginIsBlocked(
    registrationCodeAttempt(subjectHash(input.subjectKey), input.security?.ipHash),
    { database, now },
  )
}

/*
 * One wrong emailed code. Counted in the database rather than as the row's
 * count plus one, so two misses landing together are two misses, and the miss
 * that reaches the limit burns the challenge.
 */
function countEmailCodeFailure(challengeId: string, database: SmbaDatabaseExecutor, now: Date) {
  database.update(authEmailChallenges).set({
    failedAttempts: sql`${authEmailChallenges.failedAttempts} + 1`,
    consumedAt: sql`CASE WHEN ${authEmailChallenges.failedAttempts} + 1 >= ${EMAIL_VERIFICATION_MAX_ATTEMPTS} THEN COALESCE(${authEmailChallenges.consumedAt}, ${now.getTime()}) ELSE ${authEmailChallenges.consumedAt} END`,
    updatedAt: now,
  }).where(eq(authEmailChallenges.id, challengeId)).run()
}

/**
 * Hold every public answer open for the same floor before returning, so the work
 * done on one branch and skipped on another cannot be read off the clock. Shared
 * with registration, which needs the identical property for the same reason.
 */
export async function genericAcceptedResponse(startedAt: number) {
  return genericRecoveryResponse(startedAt)
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

const RECOVERY_EMAIL_SEND_PAUSED = "Wait a few minutes before requesting another code."
const RECOVERY_EMAIL_RESEND_COOLDOWN = "Wait one minute before requesting another code."

function recoveryEmailSendAttempt(hashedSubject: string, ipHash?: string | null) {
  return requestThrottleKeys(`recovery-email-send:${hashedSubject}`, ipHash)
}

function recoveryEmailSendState(
  hashedSubject: string,
  ipHash: string | null | undefined,
  database: SmbaDatabaseExecutor,
  now: Date,
): "blocked" | "cooling" | null {
  if (loginIsBlocked(recoveryEmailSendAttempt(hashedSubject, ipHash), { database, now })) {
    return "blocked"
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
    return "cooling"
  }
  return null
}

// Why a recovery-email code would not be sent now, or null. Read-only, so it is checked before any code is spent.
export function recoveryEmailSendRefusal(input: {
  security?: SecurityMetadata
  subjectKey: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  const state = recoveryEmailSendState(
    subjectHash(input.subjectKey),
    input.security?.ipHash,
    database,
    now,
  )
  if (state === "blocked") return RECOVERY_EMAIL_SEND_PAUSED
  if (state === "cooling") return RECOVERY_EMAIL_RESEND_COOLDOWN
  return null
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
  const email = normalizeEmailAddress(input.email)
  if (!email) throw new Error("Enter a valid recovery email address.")
  const fullName = input.accountId
    ? accountName(input.accountId, database)
    : input.fullName?.trim()
  if (!fullName) throw new Error("This account is unavailable.")
  const hashedSubject = subjectHash(input.subjectKey)
  const attempt = recoveryEmailSendAttempt(hashedSubject, input.security?.ipHash)
  const sendState = recoveryEmailSendState(hashedSubject, input.security?.ipHash, database, now)
  if (sendState === "blocked") {
    writeAuthSecurityEvent({
      accountId: input.accountId,
      eventType: "recovery_email_verification_requested",
      ipHash: input.security?.ipHash,
      outcome: "blocked",
      userAgent: input.security?.userAgent,
    }, { database, now })
    throw new Error(RECOVERY_EMAIL_SEND_PAUSED)
  }
  if (sendState === "cooling") throw new Error(RECOVERY_EMAIL_RESEND_COOLDOWN)

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
    recordLoginSuccess(
      recoveryEmailCodeAttempt(hashedSubject, input.security?.ipHash).subjectHash,
      { database },
    )
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
  const email = normalizeEmailAddress(input.email)
  const hashedSubject = subjectHash(input.subjectKey)
  const attempt = recoveryEmailCodeAttempt(hashedSubject, input.security?.ipHash)
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
    countEmailCodeFailure(challenge.id, database, now)
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
      if (existing && existing.email !== email) {
        retireRecoveryWorkForOldAddress(input.accountId!, email, tx, now)
      }
      writeAuthSecurityEvent({
        accountId: input.accountId,
        eventType: existing ? "recovery_email_changed" : "recovery_email_verified",
        ipHash: input.security?.ipHash,
        outcome: "success",
        userAgent: input.security?.userAgent,
      }, { database: tx, now })
    }, { behavior: "immediate" })
    return {
      email,
      previousEmail: existing && existing.email !== email ? existing.email : null,
      receiptToken: null,
    }
  }

  const receiptToken = randomBytes(32).toString("base64url")
  database.update(authEmailChallenges).set({
    expiresAt: new Date(now.getTime() + HEAD_SETUP_VERIFIED_EMAIL_LIFETIME_MS),
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
  return { email, previousEmail: null, receiptToken }
}

// A changed recovery address retires reset links and reset requests tied to the old inbox.
function retireRecoveryWorkForOldAddress(
  accountId: string,
  newEmail: string,
  database: SmbaDatabaseExecutor,
  now: Date,
) {
  database.update(authEmailChallenges).set({ consumedAt: now, updatedAt: now })
    .where(and(
      eq(authEmailChallenges.accountId, accountId),
      eq(authEmailChallenges.purpose, "password_reset"),
      isNull(authEmailChallenges.consumedAt),
    )).run()
  // Withdrawn by the account itself, not "expired": the coach made this change
  // and is not to be told later that the request ran out unanswered.
  database.update(authAuthenticatorResetRequests).set({
    resolvedAt: now,
    resolvedByAccountId: accountId,
    status: "rejected",
    updatedAt: now,
  }).where(and(
    eq(authAuthenticatorResetRequests.accountId, accountId),
    eq(authAuthenticatorResetRequests.status, "pending"),
    ne(authAuthenticatorResetRequests.recoveryEmail, newEmail),
  )).run()
}

/**
 * Tells the address that was just replaced. Best effort: the change has
 * already happened, and a mail outage must not turn it into an error. Nothing
 * is sent when the address did not actually change.
 */
export async function notifyRecoveryEmailReplaced(input: {
  accountId: string
  mailer?: AuthMailer
  newEmail: string
  previousEmail: string | null | undefined
}, {
  database = initializeDatabase(),
}: {
  database?: SmbaDatabaseExecutor
} = {}) {
  if (!input.previousEmail || input.previousEmail === input.newEmail) return false
  const fullName = accountName(input.accountId, database)
  if (!fullName) return false
  try {
    const mailer = input.mailer ?? createAuthMailer()
    if (!mailer.sendSecurityNotice) return false
    await mailer.sendSecurityNotice({
      fullName,
      lines: [
        `The recovery email for your SMBA account was changed to ${maskRecoveryEmail(input.newEmail)}. Password reset emails now go there, and any reset link sent to this address no longer works.`,
        "If you made this change, there is nothing more to do. If you did not, speak to the academy straight away.",
      ],
      subject: "Your SMBA recovery email was changed",
      to: input.previousEmail,
    })
    return true
  } catch {
    return false
  }
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
  // Every other path that records a recovery address leaves this row; the
  // head coach's own setup was the one that did not.
  writeAuthSecurityEvent({
    accountId: input.accountId,
    eventType: "recovery_email_verified",
    metadata: { source: "head_coach_setup" },
    outcome: "success",
  }, { database, now })
  return challenge.email
}

/**
 * Send a registration code. Deliberately shaped like
 * {@link requestRecoveryEmailVerification} -- same throttle, same 60s cooldown,
 * same supersede-then-insert -- with one difference: there is no account yet, so
 * `accountId` stays null and the subject is the identity itself.
 *
 * `standing` is resolved by the caller and handed straight to the mailer. It is
 * the half of the answer the browser never sees: the public response is the same
 * whether or not this identity is already registered, so probing the form tells
 * an attacker nothing, while the person who can actually read the address is
 * told plainly where their request stands.
 */
export async function requestRegistrationVerification(input: {
  academyId?: string | null
  email: string
  fullName: string
  mailer?: AuthMailer
  purpose?: "registration" | "status"
  security?: SecurityMetadata
  standing: "new" | "pending" | "approved" | "rejected"
  subjectKey: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const email = normalizeEmailAddress(input.email)
  if (!email) throw new Error("Enter a valid email address.")
  const fullName = input.fullName.trim()
  if (!fullName) throw new Error("Enter the player’s full name.")
  const hashedSubject = subjectHash(input.subjectKey)
  /*
   * One ceiling gates the requester, and it is the only thing that can refuse
   * anybody: per (identity, IP) at five, and -- through the namespaced address
   * half of the key -- per IP at twenty. Both halves are spent by the person
   * making the request and by nobody else.
   *
   * There is deliberately NO ceiling scoped to the contact address alone. One
   * was added here and it was worse than the problem it solved: five sends under
   * junk names from a single IP silently closed both registration and the status
   * lookup for that address for fifteen minutes, renewable indefinitely, while
   * both doors answered "accepted" -- and the codes that did land were bound to
   * the junk identities, so the address's real owner could not use them either.
   * It also fired with no attacker at all: one family address, three children and
   * two resends is five sends, and the sixth was silently dropped.
   *
   * That is not a bug in the threshold. Any ceiling counting sends to an address
   * is spendable by whoever generates the volume, so it is always a lock on the
   * person who owns that address. Between an inbox that can be flooded and a
   * family that cannot register a child, the flood is the lesser harm.
   */
  const attempt = requestThrottleKeys(
    `registration-send:${hashedSubject}:${authSubjectHash(input.security?.ipHash ?? "unknown-ip")}`,
    input.security?.ipHash,
  )
  const blocked = loginIsBlocked(attempt, { database, now })
  if (blocked) {
    writeAuthSecurityEvent({
      eventType: "recovery_email_verification_requested",
      ipHash: input.security?.ipHash,
      outcome: "blocked",
      subjectHash: hashedSubject,
      userAgent: input.security?.userAgent,
    }, { database, now })
  }
  /*
   * Scoped to (address, identity), and it has been both ways now. Scoped to the
   * address alone it bounded floods nicely and was a lock: anyone who knew an
   * address could send under a junk name every sixty seconds and silently
   * suppress every registration and status lookup for its real owner, forever.
   * Reproduced at 241 attacker requests against 24 victim attempts across both
   * doors -- the victim received nothing.
   *
   * So the cooldown now only ever refuses a resend for the same identity, which
   * is a thing only that requester can trigger. What bounds a flood is the
   * requester's own budget: five per identity and twenty per address per
   * fifteen minutes. A distributed sender can still exceed that, and closing
   * that properly needs bot detection at the edge rather than another ceiling
   * here -- every ceiling scoped to the victim's address is a lock on the
   * victim.
   */
  const latest = database.select({ createdAt: authEmailChallenges.createdAt })
    .from(authEmailChallenges)
    .where(and(
      eq(authEmailChallenges.email, email),
      eq(authEmailChallenges.subjectHash, hashedSubject),
      isNull(authEmailChallenges.consumedAt),
      eq(authEmailChallenges.purpose, "verify_email"),
    ))
    .orderBy(desc(authEmailChallenges.createdAt))
    .get()
  const cooling = Boolean(latest) && now.getTime() - latest!.createdAt.getTime() < EMAIL_RESEND_COOLDOWN_MS
  /*
   * Every ceiling gates the mail, never the answer. Throwing here produced three
   * distinguishable replies on a public endpoint -- accepted at 143ms, "wait one
   * minute" at 1.0ms, "wait a few minutes" at 1.0ms -- which is a live activity
   * monitor for any name and address someone can guess, and it skipped the
   * timing floor the accepted branch is careful to hold.
   */
  if (blocked || cooling) return

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
  const challengeId = randomUUID()
  recordLoginFailure(attempt, { database, now })
  database.insert(authEmailChallenges).values({
    id: challengeId,
    accountId: null,
    subjectHash: hashedSubject,
    purpose: "verify_email",
    email,
    secretHash: challengeSecretHash("verify_email", hashedSubject, challengeId, code),
    expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_LIFETIME_MS),
    createdAt: now,
    updatedAt: now,
  }).run()

  try {
    await (input.mailer ?? createAuthMailer()).sendRegistrationVerification({
      academyId: input.academyId ?? null,
      code,
      purpose: input.purpose ?? "registration",
      expiresInMinutes: EMAIL_VERIFICATION_LIFETIME_MS / 60_000,
      fullName,
      standing: input.standing,
      to: email,
    })
  } catch (error) {
    database.update(authEmailChallenges).set({ consumedAt: now, updatedAt: now })
      .where(eq(authEmailChallenges.id, challengeId)).run()
    writeAuthSecurityEvent({
      eventType: "recovery_email_verification_requested",
      ipHash: input.security?.ipHash,
      metadata: { reason: "email_delivery" },
      outcome: "failure",
      subjectHash: hashedSubject,
      userAgent: input.security?.userAgent,
    }, { database, now })
    throw error
  }
  /*
   * The older codes are retired only once the new one has actually been
   * delivered. Superseding first meant a mailer failure left the person with
   * nothing: the supersede had already committed, and consuming the undelivered
   * challenge is not a restore. Confirmation reads the newest live challenge, so
   * the brief overlap resolves to the code that was just sent.
   */
  database.update(authEmailChallenges).set({ consumedAt: now, updatedAt: now })
    .where(and(
      eq(authEmailChallenges.subjectHash, hashedSubject),
      eq(authEmailChallenges.purpose, "verify_email"),
      isNull(authEmailChallenges.consumedAt),
      // Only codes asked for before this one: two overlapping requests used to
      // retire each other, leaving neither emailed code usable.
      lt(authEmailChallenges.createdAt, now),
    )).run()
  return { email }
}

/**
 * Verify a registration code and burn the challenge. Returns the verified
 * address, or null for every failure alike -- wrong, expired, exhausted,
 * blocked and never-existed are one answer, so the caller has nothing to leak.
 *
 * Takes an injected `database` so the caller can hand it a transaction: the
 * challenge must be consumed in the same transaction that writes the account, or
 * a crash between the two either burns a code with no account to show for it or
 * leaves a spent code reusable.
 */
export function confirmRegistrationVerification<T>(input: {
  code: string
  onVerified: (tx: SmbaDatabaseExecutor, email: string) => T
  security?: SecurityMetadata
  subjectKey: string
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}): T | null {
  const hashedSubject = subjectHash(input.subjectKey)
  /*
   * Per (identity, IP), not per identity. The identity is a name and an address
   * anyone can type, so a stranger's five wrong guesses used to block the bucket
   * belonging to the person whose inbox actually holds the code -- and the same
   * block covers the status lookup, which is the route that exists so someone
   * who lost their original browser can still get in.
   *
   * The per-challenge `failedAttempts` counter below is the brute-force limit on
   * the code itself, and it is deliberately not IP-scoped.
   */
  const attempt = registrationCodeAttempt(hashedSubject, input.security?.ipHash)
  const code = input.code.replace(/\s+/gu, "")
  if (!/^\d{6}$/u.test(code)) return null
  if (loginIsBlocked(attempt, { database, now })) return null
  const challenge = database.select().from(authEmailChallenges)
    .where(and(
      eq(authEmailChallenges.subjectHash, hashedSubject),
      eq(authEmailChallenges.purpose, "verify_email"),
      isNull(authEmailChallenges.consumedAt),
      gt(authEmailChallenges.expiresAt, now),
    ))
    .orderBy(desc(authEmailChallenges.createdAt))
    .get()
  if (!challenge || challenge.failedAttempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) return null
  const suppliedHash = challengeSecretHash("verify_email", hashedSubject, challenge.id, code)
  if (!equalDigest(challenge.secretHash, suppliedHash)) {
    // The fifth miss burns the challenge outright rather than leaving a
    // guessable row behind for the next attempt to resume against.
    countEmailCodeFailure(challenge.id, database, now)
    recordLoginFailure(attempt, { database, now })
    return null
  }
  /*
   * One transaction for the burn and whatever the caller writes off the back of
   * it. `onVerified` runs inside it deliberately: an account created without the
   * challenge being consumed leaves a spent code still usable, and a challenge
   * consumed without the account leaves someone holding a code that will never
   * work again. Neither half is recoverable from the outside, so they commit or
   * fail together.
   */
  const result = database.transaction((tx) => {
    tx.update(authEmailChallenges).set({
      consumedAt: now,
      verifiedAt: now,
      updatedAt: now,
    }).where(eq(authEmailChallenges.id, challenge.id)).run()
    return input.onVerified(tx, challenge.email)
  }, { behavior: "immediate" })
  recordLoginSuccess(attempt.subjectHash, { database })
  return result
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

// Which page a recovery link belongs to; folded into the stored hash so a link only opens its own page.
export type RecoveryLinkIntent = "authenticator" | "password"

function recoverySecretHash(
  intent: RecoveryLinkIntent,
  hashedSubject: string,
  challengeId: string,
  value: string,
) {
  return challengeSecretHash(
    "password_reset",
    hashedSubject,
    challengeId,
    intent === "password" ? value : `authenticator:${value.trim()}`,
  )
}

export async function requestPasswordRecovery(input: {
  academyId: string
  email: string
  intent?: RecoveryLinkIntent
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
  const email = normalizeEmailAddress(input.email)
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
  database.insert(authEmailChallenges).values({
    id: challengeId,
    accountId: account.accountId,
    subjectHash: hashedSubject,
    purpose: "password_reset",
    email,
    secretHash: recoverySecretHash(intent, hashedSubject, challengeId, token),
    expiresAt: new Date(now.getTime() + PASSWORD_RECOVERY_LIFETIME_MS),
    createdAt: now,
    updatedAt: now,
  }).run()

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
    return genericRecoveryResponse(startedAt)
  }
  // Older links are retired only after the new one is delivered, and a link already opened in a browser is left alone.
  database.update(authEmailChallenges).set({ consumedAt: now, updatedAt: now })
    .where(and(
      eq(authEmailChallenges.accountId, account.accountId),
      eq(authEmailChallenges.purpose, "password_reset"),
      isNull(authEmailChallenges.consumedAt),
      isNull(authEmailChallenges.claimedAt),
      // Only links asked for before this one. Retiring every other link let
      // two overlapping requests (a double tap, two tabs) retire each other,
      // and both emailed links were dead; now the later one always survives.
      lt(authEmailChallenges.createdAt, now),
    )).run()
  writeAuthSecurityEvent({
    accountId: account.accountId,
    eventType: intent === "authenticator" ? "totp_recovery_email_sent" : "password_recovery_requested",
    ipHash: input.security?.ipHash,
    outcome: "success",
    subjectHash: publicSubject,
    userAgent: input.security?.userAgent,
  }, { database, now })
  return genericRecoveryResponse(startedAt)
}

/*
 * The live challenge a link or a browser pass opens. It must still be sent to
 * the account's current recovery address: a family that replaces the address
 * because someone else can read the old inbox has to be able to rely on every
 * link in that inbox dying with the change.
 */
function recoveryChallenge(
  token: string,
  intent: RecoveryLinkIntent,
  database: SmbaDatabaseExecutor,
  now: Date,
) {
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
    .innerJoin(authRecoveryEmails, and(
      eq(authRecoveryEmails.accountId, accounts.id),
      eq(authRecoveryEmails.email, authEmailChallenges.email),
    ))
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
    const suppliedHash = recoverySecretHash(intent, hashedSubject, row.challengeId, token)
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

/**
 * How long after the owner approves an authenticator reset the head coach may
 * also reset a forgotten password by email alone. The same span the request
 * itself was allowed to wait for approval.
 */
export const APPROVED_RESET_PASSWORD_WINDOW_MS = AUTHENTICATOR_RESET_REQUEST_LIFETIME_MS

function recentlyApprovedAuthenticatorReset(
  accountId: string,
  email: string,
  database: SmbaDatabaseExecutor,
  now: Date,
) {
  return Boolean(database.select({ id: authAuthenticatorResetRequests.id })
    .from(authAuthenticatorResetRequests)
    .where(and(
      eq(authAuthenticatorResetRequests.accountId, accountId),
      eq(authAuthenticatorResetRequests.status, "approved"),
      // Only for the inbox the owner approved. A recovery address changed
      // since then has not been vouched for by anybody.
      eq(authAuthenticatorResetRequests.recoveryEmail, email),
      gt(authAuthenticatorResetRequests.resolvedAt, new Date(now.getTime() - APPROVED_RESET_PASSWORD_WINDOW_MS)),
    ))
    .get())
}

/*
 * What a protected account (head coach, owner) must show besides the emailed
 * link before its password can be reset.
 *
 * The rule exists so that the recovery inbox alone cannot take the account.
 * With a connected authenticator, that is the authenticator. Without one there
 * was nothing to show at all, so a head coach who lost the phone and also
 * forgot the password was stuck even after the owner approved the reset --
 * the very approval that already accepted "this inbox plus the owner's yes" as
 * enough to remove the authenticator. For a day after that approval, and only
 * from the inbox that was approved, the same proof is enough to set a new
 * password. The owner's queue says so beside the Approve button, so the owner
 * knows that is what they are agreeing to. Outside it there is still no way
 * through by email, and the page says so rather than asking for a code that
 * cannot exist.
 */
function recoverySecondFactorRule(row: {
  accessLevel: "head_admin" | "junior_coach" | null
  accountId: string | null
  email: string
  role: "coach" | "platform_admin" | "player" | null
}, database: SmbaDatabaseExecutor, now: Date): "not_required" | "required" | "unavailable" {
  if (!roleRequiresRecoverySecondFactor(row) || !row.accountId) return "not_required"
  const factor = database.select({ verified: authTwoFactors.verified })
    .from(authTwoFactors)
    .where(eq(authTwoFactors.userId, row.accountId))
    .get()
  if (factor?.verified) return "required"
  if (row.role === "coach" && recentlyApprovedAuthenticatorReset(row.accountId, row.email, database, now)) {
    return "not_required"
  }
  return "unavailable"
}

/**
 * Whether an emailed link can still be opened. Read-only: opening the email
 * link only shows a page, and nothing is used up until the person presses
 * Continue on it, so a mail scanner or a link preview that fetches the link
 * first no longer spends it.
 */
export function recoveryLinkIsOpenable(token: string, intent: RecoveryLinkIntent, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  const challenge = recoveryChallenge(token, intent, database, now)
  return Boolean(challenge && !challenge.claimedAt)
}

/**
 * Whether an unopened password link leads to a reset that email alone cannot
 * finish (a protected account with no authenticator and no recent approval).
 * The link page says so up front instead of promising a new password and
 * spending the link on Continue only to say it there.
 */
export function passwordRecoveryLinkBlocked(token: string, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  now?: Date
} = {}) {
  const challenge = recoveryChallenge(token, "password", database, now)
  if (!challenge || challenge.claimedAt || !challenge.role) return null
  return recoverySecondFactorRule(challenge, database, now) === "unavailable"
    ? { academyId: challenge.academyId, owner: challenge.role === "platform_admin" }
    : null
}

// Opens an emailed link once: the stored hash moves to a new pass for this browser's cookie. Null when unusable.
export function claimPasswordRecovery(token: string, {
  database = initializeDatabase(),
  intent = "password",
  now = new Date(),
}: {
  database?: SmbaDatabaseExecutor
  intent?: RecoveryLinkIntent
  now?: Date
} = {}) {
  const challenge = recoveryChallenge(token, intent, database, now)
  if (!challenge?.accountId || challenge.claimedAt) return null
  const pass = randomBytes(32).toString("base64url")
  const hashedSubject = subjectHash(recoverySubjectKeyForAccount(challenge.accountId))
  const claimed = database.update(authEmailChallenges).set({
    claimedAt: now,
    secretHash: recoverySecretHash(intent, hashedSubject, challenge.challengeId, pass),
    updatedAt: now,
  })
    .where(and(
      eq(authEmailChallenges.id, challenge.challengeId),
      isNull(authEmailChallenges.claimedAt),
      isNull(authEmailChallenges.consumedAt),
      gt(authEmailChallenges.expiresAt, now),
    )).run().changes === 1
  return claimed ? pass : null
}

export type PasswordRecoveryStatus =
  | { state: "missing" }
  | { academyId: string; owner: boolean; state: "unavailable" }
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
  const challenge = recoveryChallenge(token, "password", database, now)
  if (!challenge?.claimedAt || !challenge.role) return { state: "missing" }
  const rule = recoverySecondFactorRule(challenge, database, now)
  if (rule === "unavailable") {
    return {
      academyId: challenge.academyId,
      owner: challenge.role === "platform_admin",
      state: "unavailable",
    }
  }
  const requiresSecondFactor = rule === "required"
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
  const challenge = recoveryChallenge(token, "authenticator", database, now)
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
  const challenge = recoveryChallenge(input.token, "authenticator", database, now)
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
  operation: string
  scope: SecondFactorScope
  security?: SecurityMetadata
}, {
  database,
  now,
}: {
  database: SmbaDatabase
  now: Date
}): Promise<"blocked" | "invalid" | "verified"> {
  const factor = database.select().from(authTwoFactors)
    .where(eq(authTwoFactors.userId, input.accountId)).get()
  if (!factor?.verified) return "invalid"
  // The lock on the factor row is Better Auth's sign-in lockout. It belongs to
  // the checks made before anyone is signed in -- sign-in and password recovery
  // -- and Better Auth itself ignores it on its in-session path. Honouring it
  // here for an in-session check let anyone holding only a coach's PIN fail
  // eight sign-in codes and block the real coach, signed in elsewhere, from
  // changing their recovery email; counting in-session misses on it let those
  // misses lock sign-in in turn. Each side keeps to its own counter.
  const signInScope = input.scope === "challenge"
  if (signInScope && factor.lockedUntil && factor.lockedUntil > now) return "blocked"
  // This scope's per-account budget, spent before the slow decrypt-and-compare
  // below so that a burst of parallel guesses cannot all read "not locked" first.
  if (!reserveSecondFactorAttempt(input.accountId, input.scope, { database, now })) return "blocked"

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

  if (!valid && !signInScope) return "invalid"
  if (!valid) {
    // Counted in the database, not from the row read before the await: a
    // read-add-write from that stale copy let parallel failures collapse into
    // one, and wrote `lockedUntil: null` over a lock that sign-in had set in the
    // meantime. A failure never lifts a lock that is still running. One that
    // has run out starts a fresh count, as Better Auth's own lockout does, so a
    // single typo after a lock does not lock again.
    const lockExpired = sql`(${authTwoFactors.lockedUntil} IS NOT NULL AND ${authTwoFactors.lockedUntil} <= ${now.getTime()})`
    const failures = sql`(CASE WHEN ${lockExpired} THEN 1 ELSE ${authTwoFactors.failedVerificationCount} + 1 END)`
    database.update(authTwoFactors).set({
      failedVerificationCount: failures,
      lockedUntil: sql`CASE WHEN ${failures} >= ${SECOND_FACTOR_FAILURE_LIMIT} THEN ${now.getTime() + SECOND_FACTOR_LOCK_MS} WHEN ${lockExpired} THEN NULL ELSE ${authTwoFactors.lockedUntil} END`,
    }).where(eq(authTwoFactors.id, factor.id)).run()
    return "invalid"
  }

  /*
   * A signed-in check keeps off the sign-in lock in success as it does in
   * failure: proving the code inside a session used to clear a lock that
   * somebody guessing at the sign-in page had run up, handing them a fresh
   * eight. Only a spent recovery code is written back from a signed-in check.
   */
  if (updatedBackupCodes) {
    const update = database.update(authTwoFactors).set(signInScope
      ? { backupCodes: updatedBackupCodes, failedVerificationCount: 0, lockedUntil: null }
      : { backupCodes: updatedBackupCodes })
      .where(and(
        eq(authTwoFactors.id, factor.id),
        eq(authTwoFactors.backupCodes, factor.backupCodes),
      )).run()
    if (update.changes !== 1) return "invalid"
    // A recovery code stands in for the authenticator, and each is single-use,
    // so every use is one the owner's security alert must hear about --
    // including here, where a recovery code is spent to reset a password or
    // move the recovery email.
    writeAuthSecurityEvent({
      accountId: input.accountId,
      eventType: "totp_verified",
      ipHash: input.security?.ipHash,
      metadata: { method: "backup_code", operation: input.operation },
      outcome: "success",
      userAgent: input.security?.userAgent,
    }, { database, now })
  } else if (signInScope) {
    database.update(authTwoFactors).set({
      failedVerificationCount: 0,
      lockedUntil: null,
    }).where(eq(authTwoFactors.id, factor.id)).run()
  }
  releaseSecondFactorAttempt(input.accountId, { database })
  return "verified"
}

function passwordRecoveryFactorAttempt(accountId: string, ipHash?: string | null) {
  return requestThrottleKeys(`recovery-factor:${accountId}`, ipHash, "recovery-code")
}

function freshAccountFactorAttempt(accountId: string, ipHash?: string | null) {
  return requestThrottleKeys(`fresh-account-factor:${accountId}`, ipHash, "recovery-code")
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
  const challenge = recoveryChallenge(input.token, "password", database, now)
  if (!challenge?.accountId || !challenge.claimedAt || !roleRequiresRecoverySecondFactor(challenge)) {
    return false
  }
  const attempt = passwordRecoveryFactorAttempt(challenge.accountId, input.security?.ipHash)
  const blocked = () => {
    writeAuthSecurityEvent({
      accountId: challenge.accountId,
      eventType: "password_recovery_failed",
      ipHash: input.security?.ipHash,
      outcome: "blocked",
      userAgent: input.security?.userAgent,
    }, { database, now })
    return false
  }
  // Reserved before the check, not counted after it (see reserveLoginAttempt).
  if (!reserveLoginAttempt(attempt, { database, now })) return blocked()
  const result = await verifyAccountSecondFactor({
    accountId: challenge.accountId,
    credential: input.credential,
    operation: "password_recovery",
    scope: "challenge",
    security: input.security,
  }, { database, now })
  if (result === "blocked") return blocked()
  if (result === "invalid") {
    writeAuthSecurityEvent({
      accountId: challenge.accountId,
      eventType: "password_recovery_failed",
      ipHash: input.security?.ipHash,
      outcome: "failure",
      userAgent: input.security?.userAgent,
    }, { database, now })
    return false
  }
  releaseLoginAttempt(attempt, { database, now })
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
  operation?: string
  security?: SecurityMetadata
}, options?: {
  database?: SmbaDatabase
  now?: Date
}) {
  const database = options?.database ?? initializeDatabase()
  const now = options?.now ?? new Date()
  const attempt = freshAccountFactorAttempt(input.accountId, input.security?.ipHash)
  if (!reserveLoginAttempt(attempt, { database, now })) return false
  const result = await verifyAccountSecondFactor({
    accountId: input.accountId,
    credential: input.credential,
    operation: input.operation ?? "change_recovery_email",
    scope: "session",
    security: input.security,
  }, { database, now })
  if (result !== "verified") return false
  releaseLoginAttempt(attempt, { database, now })
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
  const challenge = recoveryChallenge(input.token, "password", database, now)
  if (!challenge?.accountId || !challenge.claimedAt || !challenge.role) return false
  const rule = recoverySecondFactorRule(challenge, database, now)
  if (rule === "unavailable") return false
  if (rule === "required" && !challenge.secondFactorVerifiedAt) return false
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
    // The person has just proved the account is theirs and chosen a new
    // password; the pause their earlier wrong guesses ran up would otherwise
    // refuse that new password with "wait a few minutes".
    clearSignInPauses(challenge.academyId, { database: tx })
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

/** Why email alone cannot reset a protected account with no authenticator. */
export function protectedResetUnavailableCopy(academyId: string, owner: boolean) {
  return owner
    ? `${academyId} is the platform admin account and has no authenticator connected, so its password cannot be reset by email. It needs a manual fix by whoever looks after the portal’s hosting.`
    : `${academyId} is a protected account with no authenticator connected, so its password cannot be reset by email alone. That is only possible for 24 hours after the platform admin approves an authenticator reset sent from this recovery email. Contact the platform admin, confirm who you are, and ask them to help you back in.`
}
