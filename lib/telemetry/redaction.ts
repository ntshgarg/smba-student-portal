// The canonical redaction rules for anything SMBA writes about a failure. They
// started as the Playwright failure-evidence sanitizer and now also guard the
// client error reporter, so both paths stay in step instead of drifting apart.
//
// This module must remain importable from a client component: no Node built-ins,
// no database access and no other imports.

const SENSITIVE_PARAMETER = /^(?:auth|code|email|key|password|pin|recovery|secret|session|token|totp)(?:[-_].*)?$/iu

export function sanitizeFailureText(value: string) {
  return value
    // Both quantifiers are bounded to their RFC 5321 maxima rather than left open.
    // Unbounded, the local part can begin matching at every offset of a run of the
    // characters it accepts and rescan to the end of that run looking for the "@"
    // each time, which is quadratic in the run length -- on a string an
    // unauthenticated caller supplies to /api/client-errors. The bound caps the
    // rescan rather than the input, so no address a mail server would accept is
    // matched differently than before.
    .replace(/[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,255}\.[A-Z]{2,}/giu, "<redacted-email>")
    .replace(/\b(?:SMBA-(?:HC|JC|PL)-\d{4})\b/gu, "<redacted-academy-id>")
    .replace(/\b[A-Z2-7]{20,}\b/gu, "<redacted-secret>")
    .replace(/((?:password|passphrase|pin|totp|recovery[ -]?(?:code|key)?|backup[ -]?code|secret)\s*(?:=|:|is)\s*)[^&\s,;]+/giu, "$1<redacted>")
    .replace(/((?:[?&]|\b)(?:auth|code|email|key|password|pin|recovery|secret|session|token|totp)(?:[-_][a-z0-9_-]+)?=)[^&\s]+/giu, "$1<redacted>")
    .replace(/\b\d{6}\b/gu, "<redacted-six-digit-code>")
    /*
     * Indian mobile numbers, which the redactor had no rule for at all -- and a
     * guardian's mobile is the highest-value field in this product. Covers the
     * shapes people actually type: +91 98765 43210, +91-98765-43210,
     * 09876543210, 9876543210. The leading boundary is explicit rather than \b
     * so a longer digit run (an id, a timestamp) is not partially eaten.
     */
    .replace(/(?<![\d-])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\d-])/gu, "<redacted-phone>")
    // Bearer-shaped material: JWTs, and long base64url or hex runs. The academy
    // id rule above is narrower and runs first, so ids keep their own label.
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, "<redacted-token>")
    .replace(/\b[0-9a-f]{32,}\b/giu, "<redacted-token>")
    /*
     * Long base64url runs, but only ones that look like a credential: a token
     * mixes letters and digits. Without that guard a long run of one repeated
     * character -- which is what a truncation test and a stack of padding look
     * like -- was collapsed to a label, hiding the very shape it was checking.
     *
     * Both lookaheads are bounded to 80 characters rather than left open.
     * Unbounded, each one rescans the whole remaining run at every offset of a
     * run that never satisfies it, which is quadratic on a string an
     * unauthenticated caller supplies to /api/client-errors -- 32 KB of one
     * repeated digit took 517ms against a 150ms budget. A credential's letters
     * and digits are interleaved well inside 80 characters.
     */
    .replace(/\b(?=[A-Za-z0-9_-]{0,80}\d)(?=[A-Za-z0-9_-]{0,80}[A-Za-z])[A-Za-z0-9_-]{40,}\b/gu, "<redacted-token>")
    // Lowercase and legacy Academy ID spellings the uppercase rule above misses.
    .replace(/\bsmba-(?:hc|jc|pl|admin)-\d{4}\b/giu, "<redacted-academy-id>")
    .replace(/\bSMBA#\d{4}\b/giu, "<redacted-academy-id>")
}

export function sanitizeFailureUrl(value: string) {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_PARAMETER.test(key)) url.searchParams.delete(key)
    }
    url.username = ""
    url.password = ""
    url.hash = ""
    return sanitizeFailureText(url.toString())
  } catch {
    return sanitizeFailureText(value)
  }
}
