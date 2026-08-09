export type AccountRole = "player" | "coach"

export type SessionIdentity = {
  subjectId: string
  role: AccountRole
  fullName: string
  firstName: string
  initials: string
  academyId: string
}

export type StudentIdentity = {
  playerId: string
  fullName: string
  firstName: string
  initials: string
  academyId: string
}

export function normalizeFullName(value: string) {
  return value.trim().replace(/\s+/gu, " ")
}

export function normalizedNameKey(value: string) {
  return normalizeFullName(value).toLocaleLowerCase("en-IN")
}

export function normalizeAcademyId(value: string) {
  return value.trim().replace(/\s+/gu, "").toLocaleUpperCase("en-IN")
}

export function isAcademyId(value: string) {
  return /^SMBA#\d{4}$/u.test(normalizeAcademyId(value))
}

export function formatAcademyId(serial: number) {
  if (!Number.isInteger(serial) || serial < 1 || serial > 9999) {
    throw new Error("Academy ID serial is outside the supported four-digit range.")
  }

  return `SMBA#${String(serial).padStart(4, "0")}`
}

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
}): SessionIdentity {
  const { normalizedName, firstName, initials } = identityNameParts(input.fullName)

  return {
    subjectId: input.accountId,
    academyId: input.academyId,
    role: input.role,
    fullName: normalizedName,
    firstName,
    initials,
  }
}

export function createStudentIdentity(session: SessionIdentity): StudentIdentity {
  return {
    playerId: session.subjectId,
    academyId: session.academyId,
    fullName: session.fullName,
    firstName: session.firstName,
    initials: session.initials,
  }
}
