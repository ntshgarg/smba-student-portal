import "server-only"

// The two conditions that decide whether this process is a disposable rig our
// own CI built, rather than an academy, in one copy. Two callers gate a
// security-relevant escape hatch on them: `lib/auth/mailer.ts` swaps the real
// mail transport for an in-memory outbox, and `lib/clock.ts` freezes the render
// clock. They were written twice, verbatim, with a comment asking the next
// reader to keep them in step -- which is how a check like this drifts. What the
// two callers *do* when the conditions fail deliberately differs; what the
// conditions *are* does not, so only that half lives here.
//
// "Accessibility" is in the file name because the audit workflow was the first
// rig to need this. It is not the only one: the registration and activation E2E
// suite drives a production build that has to send a six-digit code and cannot
// reach a real mail provider either. Naming the predicates for the property they
// actually test keeps the next rig from being tempted to call its database
// something dishonest to squeeze past a regular expression.
const DISPOSABLE_RIG_PROFILES = ["admin", "clean", "registration", "stress"]

export const disposableRigProfiles: readonly string[] = DISPOSABLE_RIG_PROFILES

/** True only for a profile name one of the regression workflows actually exports. */
export function isDisposableRigProfile(profile: string | undefined) {
  return Boolean(profile && DISPOSABLE_RIG_PROFILES.includes(profile))
}

/**
 * True only for a database a regression workflow built for itself: an absolute
 * path under the operating system temporary root whose file name says which rig
 * it belongs to. Every deployment path fails it, and so does a local
 * `.data/academy-*.db`.
 */
export function disposableRigDatabase(databasePath = process.env.DB_FILE_NAME) {
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
    && /smba[-_.].*(accessibility|a11y|registration)/u.test(databaseName)
}
