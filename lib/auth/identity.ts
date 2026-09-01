export type AccountRole = "player" | "coach" | "platform_admin"

/**
 * What the product calls the sign-in credential, in one place.
 *
 * The same value -- column `academyId`, format SMBA-PL-0004 -- was issued and
 * taught as "Academy ID" on /activate and in the coach workspace, then asked for
 * as "SMBA username" on /login and /recover. /recover managed both at once: copy
 * reading "Enter the Academy ID" above a field labelled "SMBA username". That is
 * the front door and the locked-out path, so the hesitation costs a call to the
 * coach at the moment the user is already shut out.
 *
 * "Academy ID" wins because it is what the credential is called everywhere it is
 * issued, displayed and searched -- and because "username" implies something the
 * holder chose, which this is not.
 */
export const ACADEMY_ID_LABEL = "Academy ID"

export const PLATFORM_ADMIN_ACADEMY_ID = "SMBA-ADMIN-0001"
export const HEAD_COACH_ACADEMY_ID = "SMBA-HC-0001"

/**
 * Better Auth scopes an account by (issuer, accountId) and derives this value
 * for the built-in credential provider as `local:${encodeURIComponent(providerId)}`.
 * Password and PIN sign-in only match an account whose issuer is exactly this,
 * so it must stay in step with Better Auth rather than being chosen locally.
 */
export const CREDENTIAL_ACCOUNT_ISSUER = "local:credential"

const LEGACY_SERIAL_MAX = 9_999
const JUNIOR_COACH_SERIAL_BASE = 10_000
const PLAYER_SERIAL_BASE = 20_000
const HEAD_COACH_SERIAL_BASE = 30_000

export type SessionIdentity = {
  subjectId: string
  role: AccountRole
  fullName: string
  firstName: string
  initials: string
  academyId: string
  actorSubjectId?: string
  previewMode?: true
}

export type StudentIdentity = {
  playerId: string
  fullName: string
  firstName: string
  initials: string
  academyId: string
  actorSubjectId?: string
  previewMode?: true
}

export function normalizeFullName(value: string) {
  return value.trim().replace(/\s+/gu, " ")
}

/**
 * The comparison key for a name, never the stored or displayed form -- how a
 * person spells their own name is theirs, and NFKC would quietly rewrite it.
 *
 * NFKC matters here rather than being ceremony: Devanagari composes with
 * combining marks, so `शर्मा` pasted out of a message and `शर्मा` typed fresh can
 * be different byte sequences that render identically. Without normalising them
 * to one form, two registrations for the same player hash to two keys and the
 * duplicate this key exists to catch walks straight through.
 */
export function normalizedNameKey(value: string) {
  return normalizeFullName(value).normalize("NFKC").toLocaleLowerCase("en-IN")
}

export function normalizeAcademyId(value: string) {
  return value.trim().replace(/\s+/gu, "").toLocaleUpperCase("en-IN")
}

export function academyIdSerial(value: string) {
  const normalized = normalizeAcademyId(value)
  const legacy = /^SMBA#(\d{4})$/u.exec(normalized)
  if (legacy) {
    const serial = Number(legacy[1])
    return serial >= 1 && serial <= LEGACY_SERIAL_MAX ? serial : null
  }

  const rolePrefixed = /^SMBA-(HC|JC|PL)-(\d{4})$/u.exec(normalized)
  if (!rolePrefixed) {
    return null
  }

  const suffix = Number(rolePrefixed[2])
  if (suffix < 1 || suffix > 9_999) {
    return null
  }
  if (rolePrefixed[1] === "JC") {
    return JUNIOR_COACH_SERIAL_BASE + suffix
  }
  if (rolePrefixed[1] === "PL") {
    return PLAYER_SERIAL_BASE + suffix
  }
  return HEAD_COACH_SERIAL_BASE + suffix
}

export function isAcademyId(value: string) {
  const normalized = normalizeAcademyId(value)
  return /^SMBA#\d{4}$/u.test(normalized)
    || /^SMBA-(?:HC|JC|PL)-\d{4}$/u.test(normalized)
    || normalized === PLATFORM_ADMIN_ACADEMY_ID
}

export function formatAcademyId(serial: number) {
  if (!Number.isInteger(serial) || serial < 1 || serial >= 40_000) {
    throw new Error("Academy ID serial is outside the supported range.")
  }
  if (serial <= LEGACY_SERIAL_MAX) {
    return `SMBA#${String(serial).padStart(4, "0")}`
  }
  if (serial < PLAYER_SERIAL_BASE) {
    return `SMBA-JC-${String(serial - JUNIOR_COACH_SERIAL_BASE).padStart(4, "0")}`
  }
  if (serial < HEAD_COACH_SERIAL_BASE) {
    return `SMBA-PL-${String(serial - PLAYER_SERIAL_BASE).padStart(4, "0")}`
  }
  return `SMBA-HC-${String(serial - HEAD_COACH_SERIAL_BASE).padStart(4, "0")}`
}

export const ACADEMY_ID_SERIAL_RANGES = {
  headCoach: { first: HEAD_COACH_SERIAL_BASE + 1, last: HEAD_COACH_SERIAL_BASE + 1 },
  juniorCoach: { first: JUNIOR_COACH_SERIAL_BASE + 1, last: JUNIOR_COACH_SERIAL_BASE + 9_999 },
  player: { first: PLAYER_SERIAL_BASE + 1, last: PLAYER_SERIAL_BASE + 9_999 },
  legacy: { first: 2, last: LEGACY_SERIAL_MAX },
} as const

export function identityNameParts(fullName: string) {
  const normalizedName = normalizeFullName(fullName)
  const nameParts = normalizedName.split(" ").filter(Boolean)
  const firstName = nameParts[0] ?? normalizedName
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null
  const initials = `${firstName[0] ?? ""}${lastName?.[0] ?? ""}`.toLocaleUpperCase("en-IN")

  return { normalizedName, firstName, initials }
}

export function createSessionIdentity(input: {
  accountId: string
  academyId: string
  fullName: string
  role: AccountRole
  actorSubjectId?: string
  previewMode?: true
}): SessionIdentity {
  const { normalizedName, firstName, initials } = identityNameParts(input.fullName)

  return {
    subjectId: input.accountId,
    academyId: input.academyId,
    role: input.role,
    fullName: normalizedName,
    firstName,
    initials,
    actorSubjectId: input.actorSubjectId,
    previewMode: input.previewMode,
  }
}

export function createStudentIdentity(session: SessionIdentity): StudentIdentity {
  return {
    playerId: session.subjectId,
    academyId: session.academyId,
    fullName: session.fullName,
    firstName: session.firstName,
    initials: session.initials,
    actorSubjectId: session.actorSubjectId,
    previewMode: session.previewMode,
  }
}
