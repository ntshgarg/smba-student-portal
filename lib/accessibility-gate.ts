import "server-only"

// The two conditions that decide whether this process is the accessibility gate
// rather than an academy, in one copy. Two callers gate a security-relevant
// escape hatch on them: `lib/auth/mailer.ts` swaps the real mail transport for
// an in-memory outbox, and `lib/clock.ts` freezes the render clock. They were
// written twice, verbatim, with a comment asking the next reader to keep them in
// step -- which is how a check like this drifts. What the two callers *do* when
// the conditions fail deliberately differs; what the conditions *are* does not,
// so only that half lives here.
const ACCESSIBILITY_GATE_PROFILES = ["admin", "clean", "stress"]

export const accessibilityGateProfiles: readonly string[] = ACCESSIBILITY_GATE_PROFILES

/** True only for a profile name the accessibility workflow actually exports. */
export function isAccessibilityGateProfile(profile: string | undefined) {
  return Boolean(profile && ACCESSIBILITY_GATE_PROFILES.includes(profile))
}

/**
 * True only for a database the gate built for itself: an absolute path under the
 * operating system temporary root whose file name names the accessibility gate.
 * Every deployment path fails it, and so does a local `.data/academy-*.db`.
 */
export function disposableAccessibilityDatabase(databasePath = process.env.DB_FILE_NAME) {
  const normalizedDatabase = (databasePath?.trim() ?? "").replaceAll("\\", "/")
  if (!normalizedDatabase.startsWith("/") || normalizedDatabase.includes("/../")) return false
  const configuredTempRoot = process.env.TMPDIR?.replaceAll("\\", "/").replace(/\/+$/u, "")
  const temporaryPrefixes = [
    "/tmp/",
    "/private/tmp/",
    configuredTempRoot ? `${configuredTempRoot}/` : "",
  ].filter(Boolean)
  const inTemporaryRoot = temporaryPrefixes.some((prefix) => normalizedDatabase.startsWith(prefix))
  const databaseName = normalizedDatabase.split("/").at(-1) ?? ""
  return inTemporaryRoot
    && /smba[-_.].*(accessibility|a11y)|smba-accessibility/u.test(databaseName)
}
