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

/*
 * Characters with no width and no effect on the letters either side: soft
 * hyphen, zero-width space, the bidi marks, embeddings, overrides and isolates,
 * the word joiner and its neighbours, the byte-order mark, the Mongolian vowel
 * separator. A name carrying one is indistinguishable on screen from the same
 * name without it, so left in they split one person into two accounts, ride into
 * the CSV exports, and let a rejected applicant re-enter the queue as a stranger.
 *
 * ZWJ (U+200D) and ZWNJ (U+200C) are NOT in this set, and that is the whole
 * point of enumerating rather than reaching for \p{Cf}. In Indic scripts they
 * are letters' business: <consonant, virama, ZWJ> is how Malayalam writes a
 * chillu, and ZWNJ is how Devanagari keeps a halant visible instead of forming a
 * conjunct. Dropping them rewrites `ഗോപാല്‍` to `ഗോപാല്` and `क्‌षमा` to `क्षमा` --
 * different letters, in the name this academy prints and exports. They are
 * folded in the comparison key below instead, where changing the spelling costs
 * nothing.
 *
 * Controls become a space rather than vanishing: \p{Cc} covers tab and newline,
 * and deleting those would glue two names into one word. Every remaining run of
 * whitespace is collapsed afterwards, so neither substitution can leave a double
 * space behind.
 */
const INVISIBLE_CHARACTERS = /[­᠎​‎‏‪-‮⁠-⁤⁦-⁯﻿]/gu
const CONTROL_CHARACTERS = /\p{Cc}/gu

export function normalizeFullName(value: string) {
  return value
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(CONTROL_CHARACTERS, " ")
    .trim()
    .replace(/\s+/gu, " ")
}

/*
 * A Malayalam chillu written as <consonant, virama, ZWJ> and the atomic letter
 * are the same letter on screen, and NFKC does not unify them -- so the two
 * spellings of one name hashed apart and the duplicate the key exists to catch
 * walked straight through. Applied before the joiners are dropped, because the
 * ZWJ is what identifies the sequence.
 */
const MALAYALAM_CHILLU_FORMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ണ്‍/gu, "ൺ"],
  [/ന്‍/gu, "ൻ"],
  [/ര്‍/gu, "ർ"],
  [/ല്‍/gu, "ൽ"],
  [/ള്‍/gu, "ൾ"],
  [/ക്‍/gu, "ൿ"],
]

const JOINERS = /[‌‍]/gu

function foldJoiners(value: string) {
  const folded = MALAYALAM_CHILLU_FORMS.reduce(
    (text, [pattern, atomic]) => text.replace(pattern, atomic),
    value,
  )
  return folded.replace(JOINERS, "")
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
 *
 * NFKC runs first rather than last. It can *introduce* spaces -- the spacing
 * diacritics decompose to a space plus a combining mark, so `¨` becomes
 * `U+0020 U+0308` -- and a space created after the collapse is never collapsed.
 * That made the key non-idempotent: feeding its own output back produced a
 * different hash. The existing idempotence test missed it because it uses ASCII.
 */
export function normalizedNameKey(value: string) {
  /*
   * Normalised again at the end rather than only at the start. Dropping a
   * joiner can leave a base letter next to a combining mark it had been keeping
   * apart, and case folding can itself denormalise -- either way the pair only
   * composes on the pass after, and a key that is not a fixed point of its own
   * function hashes the same name two ways the second time it is computed.
   */
  return normalizeFullName(foldJoiners(value.normalize("NFKC")))
    .toLocaleLowerCase("en-IN")
    .normalize("NFKC")
    .toLocaleLowerCase("en-IN")
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
