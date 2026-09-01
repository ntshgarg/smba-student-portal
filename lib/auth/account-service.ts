import "server-only"

import { randomInt, randomUUID } from "node:crypto"

import { and, eq, isNotNull, isNull } from "drizzle-orm"

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
import {
  OperationalActionError,
  operationalActionError,
} from "@/lib/actions/operational-result"
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
  extendActivationClaim,
  saveActivationClaim,
} from "@/lib/auth/credential-service"
import {
  confirmRegistrationVerification,
  genericAcceptedResponse,
  normalizeEmailAddress,
  registrationSubjectKey,
  requestRegistrationVerification,
} from "@/lib/auth/recovery-service"
import { authRecoveryEmails } from "@/lib/db/schema"
import type { AuthMailer } from "@/lib/auth/mailer"
import type { RegistrationStanding } from "@/lib/auth/registration-form"
import { getAcademyDateKey } from "@/lib/format"

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

const REGISTRATION_MIN_PHONE_DIGITS = 8
const REGISTRATION_MAX_PHONE_DIGITS = 15
/** Older than this and the date is a typo, not a birthday. */
const REGISTRATION_MAX_AGE_YEARS = 120

export type { RegistrationStanding } from "@/lib/auth/registration-form"

type RegistrationSecurity = {
  ipHash?: string | null
  userAgent?: string | null
}

/**
 * The identity a registration is deduplicated on. One address may own several
 * players -- a parent registering three children is ordinary -- so the name is
 * part of the key rather than the address alone.
 *
 * Both halves are normalised first, and the separator is a space, which the
 * address validator forbids inside an address. Without that the boundary would
 * slide: ("ab", "c@d.ee") and ("a", "bc@d.ee") would otherwise hash alike.
 */
export function registrationIdentity(fullName: string, email: string) {
  const normalizedEmail = normalizeEmailAddress(email)
  const normalizedName = normalizedNameKey(fullName)
  if (!normalizedEmail || normalizedName.length < 2 || normalizedName.length > 80) return null
  return {
    normalizedEmail,
    normalizedName,
    subjectKey: registrationSubjectKey(normalizedEmail, normalizedName),
  }
}

export function normalizeRegistrationPhone(value: string) {
  const trimmed = value.trim().replace(/[\s()-]/gu, "")
  const digits = trimmed.replace(/^\+/u, "")
  if (!/^\d+$/u.test(digits)) return null
  if (digits.length < REGISTRATION_MIN_PHONE_DIGITS) return null
  if (digits.length > REGISTRATION_MAX_PHONE_DIGITS) return null
  return trimmed
}

export function validateRegistrationDateOfBirth(value: string, referenceDateKey: string) {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return null
  // Round-tripping through Date catches 2026-02-30, which the regex accepts.
  const parsed = new Date(`${trimmed}T00:00:00Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== trimmed) return null
  if (trimmed > referenceDateKey) return null
  const earliest = Number(referenceDateKey.slice(0, 4)) - REGISTRATION_MAX_AGE_YEARS
  if (Number(trimmed.slice(0, 4)) < earliest) return null
  return trimmed
}

function registrationStandingFor(identityKey: string, database: SmbaDatabaseExecutor) {
  const existing = database.select({
    academyId: authMethods.identifier,
    approvalStatus: accounts.approvalStatus,
    archivedAt: accounts.archivedAt,
    credentialStatus: authCredentialStates.status,
    fullName: accounts.fullName,
    id: accounts.id,
  }).from(accounts)
    .leftJoin(authMethods, and(
      eq(authMethods.accountId, accounts.id),
      eq(authMethods.method, "academy_id"),
      isNull(authMethods.revokedAt),
    ))
    .leftJoin(authCredentialStates, eq(authCredentialStates.accountId, accounts.id))
    .where(eq(accounts.registrationIdentityKey, identityKey))
    .get()
  // An archived account is treated as absent rather than surfaced, so archiving
  // does not become a way to read whether someone was ever registered.
  if (!existing || existing.archivedAt) return null
  return {
    academyId: existing.approvalStatus === "approved" ? existing.academyId : null,
    accountId: existing.id,
    // Approval status alone cannot tell an approved account from one that has
    // already been activated, and the status door needs to: minting a claim for
    // an activated account resurrects its consumed row and offers a password
    // form that can never succeed.
    activated: existing.credentialStatus === "active",
    fullName: existing.fullName,
    standing: existing.approvalStatus as RegistrationStanding,
  }
}

/**
 * Step one of registration: send a code, write no account.
 *
 * The returned value is identical whether or not this identity is already
 * registered -- same shape, same timing floor -- because the caller is
 * unauthenticated and the form would otherwise be an oracle for which
 * name-and-address pairs exist. The difference travels in the email.
 */
export async function requestRegistration(input: {
  dateOfBirth: string
  email: string
  fullName: string
  mailer?: AuthMailer
  phone: string
  requestedRole: AccountRole
  security?: RegistrationSecurity
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const startedAt = Date.now()
  if (input.requestedRole !== "player" && input.requestedRole !== "coach") {
    operationalActionError("INVALID_INPUT", "Choose a valid account type.", "requestedRole")
  }
  const fullName = normalizeFullName(input.fullName)
  /*
   * Name and address are checked apart even though the key needs both, so the
   * error lands on the field that is actually wrong. Collapsing them into one
   * message blamed the address for an empty name -- the first field on the form
   * -- and sent focus past everything the person had not filled in yet.
   */
  const normalizedName = normalizedNameKey(fullName)
  if (normalizedName.length < 2 || normalizedName.length > 80) {
    operationalActionError("INVALID_INPUT", "Enter the player's full name.", "fullName")
  }
  const identity = registrationIdentity(fullName, input.email)
  if (!identity) {
    operationalActionError("INVALID_INPUT", "Enter a valid email address.", "email")
  }
  if (!normalizeRegistrationPhone(input.phone)) {
    operationalActionError("INVALID_INPUT", "Enter a valid contact mobile number.", "phone")
  }
  if (!validateRegistrationDateOfBirth(input.dateOfBirth, getAcademyDateKey(now))) {
    operationalActionError("INVALID_INPUT", "Enter a valid date of birth.", "dateOfBirth")
  }
  const existing = registrationStandingFor(identity.subjectKey, database)
  try {
    await requestRegistrationVerification({
      academyId: existing?.academyId ?? null,
      email: identity.normalizedEmail,
      fullName: existing?.fullName ?? fullName,
      mailer: input.mailer,
      security: input.security,
      standing: existing?.standing ?? "new",
      subjectKey: identity.subjectKey,
    }, { database, now })
  } catch (error) {
    /*
     * Throttle trips, the resend cooldown and a mail-delivery failure all arrive
     * as plain Errors, and all three are things the person in front of the form
     * can recover from by waiting or trying another address. Retyping them as
     * OperationalActionError here means the action can tell "show this" from
     * "let this reach the error boundary" structurally, rather than by matching
     * message text -- which had already gone wrong once, since a regex for
     * "unavailable" also swallows "database unavailable".
     */
    throw new OperationalActionError(
      "BUSINESS_RULE",
      error instanceof Error ? error.message : "We could not send a code just now.",
      "email",
    )
  }
  return genericAcceptedResponse(startedAt)
}

export type RegistrationConfirmation = {
  academyId: string | null
  accountId: string | null
  standing: RegistrationStanding
}

/**
 * Step two: the code is correct, so either surface the request that already
 * exists or write the one that does not. Both branches happen inside the
 * transaction that burns the challenge.
 */
export function confirmRegistration(input: {
  activationToken?: string
  code: string
  createId?: () => string
  dateOfBirth: string
  email: string
  fullName: string
  phone: string
  requestedRole: AccountRole
  security?: RegistrationSecurity
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}): RegistrationConfirmation | null {
  const createId = input.createId ?? randomUUID
  const fullName = normalizeFullName(input.fullName)
  const identity = registrationIdentity(fullName, input.email)
  if (!identity) return null
  const phone = normalizeRegistrationPhone(input.phone)
  const dateOfBirth = validateRegistrationDateOfBirth(input.dateOfBirth, getAcademyDateKey(now))
  if (!phone || !dateOfBirth) return null
  if (input.requestedRole !== "player" && input.requestedRole !== "coach") return null

  return confirmRegistrationVerification({
    code: input.code,
    onVerified: (tx, email): RegistrationConfirmation => {
      const existing = registrationStandingFor(identity.subjectKey, tx)
      if (existing) {
        return {
          academyId: existing.academyId,
          accountId: null,
          standing: existing.standing,
        }
      }
      /*
       * An archived row reads as absent everywhere else in this file, so it must
       * not still own the identity in the index. `archiveMemberRecord` releases
       * the key, and this releases any that predates that or arrives another
       * way: without it the insert below collides, throws a raw constraint error
       * past the action's error handling, and rolls back leaving the code
       * unspent -- so a returning ex-member retried forever and never got in.
       */
      tx.update(accounts).set({ registrationIdentityKey: null, updatedAt: now })
        .where(and(
          eq(accounts.registrationIdentityKey, identity.subjectKey),
          isNotNull(accounts.archivedAt),
        )).run()
      const accountId = createId()
      tx.insert(accounts).values({
        id: accountId,
        fullName,
        normalizedName: identity.normalizedName,
        registrationIdentityKey: identity.subjectKey,
        contactEmail: email,
        contactPhone: phone,
        dateOfBirth,
        requestedRole: input.requestedRole,
        approvalStatus: "pending",
        createdAt: now,
        updatedAt: now,
      }).run()
      /*
       * The address is already verified, so record it now rather than asking for
       * it again after approval. completeAccountActivation requires a verified
       * recovery email before a password can be set; satisfying that here is what
       * removes the enrolment step from activation entirely.
       */
      tx.insert(authRecoveryEmails).values({
        accountId,
        email,
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      }).run()
      if (input.activationToken) {
        saveActivationClaim({ accountId, token: input.activationToken }, { database: tx, now })
      }
      return { academyId: null, accountId, standing: "new" as const }
    },
    security: input.security,
    subjectKey: identity.subjectKey,
  }, { database, now })
}

export type RegistrationStatusView = {
  academyId: string | null
  /** For the caller to mint an activation claim with. Never send it to a client. */
  accountId: string | null
  /** Already has a password. The status door must offer sign-in, not setup. */
  activated: boolean
  fullName: string | null
  onboardingCompleted: boolean
  standing: RegistrationStanding
}

/**
 * Send a code so someone can look up where their request stands, from any device.
 *
 * Until this existed the only link between a person and their request was the
 * activation cookie, so clearing it or switching phone left them with no way to
 * ask -- and the only button on screen was "request registration". A share of the
 * duplicate queue is that, not abuse.
 *
 * An identity with no request behind it is treated exactly like one that has a
 * request: same response, same code, same timing. The email says there is nothing
 * on file, which only the holder of the address ever reads.
 */
export async function requestRegistrationStatus(input: {
  email: string
  fullName: string
  mailer?: AuthMailer
  security?: RegistrationSecurity
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}) {
  const startedAt = Date.now()
  const fullName = normalizeFullName(input.fullName)
  const normalizedName = normalizedNameKey(fullName)
  if (normalizedName.length < 2 || normalizedName.length > 80) {
    operationalActionError("INVALID_INPUT", "Enter the name the request was made in.", "fullName")
  }
  const identity = registrationIdentity(fullName, input.email)
  if (!identity) {
    operationalActionError("INVALID_INPUT", "Enter the email you registered with.", "email")
  }
  const existing = registrationStandingFor(identity.subjectKey, database)
  try {
    await requestRegistrationVerification({
      academyId: existing?.academyId ?? null,
      email: identity.normalizedEmail,
      fullName: existing?.fullName ?? fullName,
      mailer: input.mailer,
      security: input.security,
      standing: existing?.standing ?? "new",
      subjectKey: identity.subjectKey,
    }, { database, now })
  } catch (error) {
    throw new OperationalActionError(
      "BUSINESS_RULE",
      error instanceof Error ? error.message : "We could not send a code just now.",
      "email",
    )
  }
  return genericAcceptedResponse(startedAt)
}

/**
 * Verify the code and report where the request stands. Writes nothing: this is
 * the read-only twin of confirmRegistration, and an identity with no request
 * behind it reports "new" rather than creating one.
 */
export function confirmRegistrationStatus(input: {
  activationToken?: string
  code: string
  email: string
  fullName: string
  security?: RegistrationSecurity
}, {
  database = initializeDatabase(),
  now = new Date(),
}: {
  database?: SmbaDatabase
  now?: Date
} = {}): RegistrationStatusView | null {
  const fullName = normalizeFullName(input.fullName)
  const identity = registrationIdentity(fullName, input.email)
  if (!identity) return null

  return confirmRegistrationVerification({
    code: input.code,
    onVerified: (tx): RegistrationStatusView => {
      const existing = registrationStandingFor(identity.subjectKey, tx)
      if (!existing) {
        return {
          academyId: null,
          accountId: null,
          activated: false,
          fullName: null,
          onboardingCompleted: false,
          standing: "new",
        }
      }
      /*
       * A player may only set a password once the coach has finished onboarding
       * them -- assessment, session and fee plan. An assistant coach has no
       * onboarding to finish, so approval is the whole gate for them.
       */
      const enrollment = tx.select({ onboardingCompletedAt: playerEnrollments.onboardingCompletedAt })
        .from(playerEnrollments)
        .where(eq(playerEnrollments.accountId, existing.accountId))
        .get()
      const onboardingCompleted = enrollment
        ? Boolean(enrollment.onboardingCompletedAt)
        : existing.standing === "approved"
      /*
       * A claim is minted here when the password step is actually reachable, so a
       * person who has lost the browser they registered in can still activate.
       * Email verification is the same proof password recovery already accepts,
       * and the claim is written inside the transaction that burned the code.
       */
      const activatable = existing.standing === "approved"
        && onboardingCompleted
        && !existing.activated
      /*
       * Never for an account that already has a password. saveActivationClaim
       * upserts with `consumedAt: null`, so minting here un-spent the claim that
       * activation had burned, overwrote the token hash the original browser
       * held, and handed this one a password form that completeAccountActivation
       * refuses -- a dead end offered to someone who only needs to sign in.
       */
      if (input.activationToken && activatable) {
        saveActivationClaim(
          { accountId: existing.accountId, token: input.activationToken },
          { database: tx, now },
        )
      }
      return {
        academyId: existing.academyId,
        accountId: existing.accountId,
        activated: existing.activated,
        fullName: existing.fullName,
        onboardingCompleted,
        standing: existing.standing,
      }
    },
    security: input.security,
    subjectKey: identity.subjectKey,
  }, { database, now })
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
