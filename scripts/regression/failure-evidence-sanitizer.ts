const SENSITIVE_PARAMETER = /^(?:auth|code|email|key|password|pin|recovery|secret|session|token|totp)(?:[-_].*)?$/iu

export function sanitizeFailureText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "<redacted-email>")
    .replace(/\b(?:SMBA-(?:HC|JC|PL)-\d{4})\b/gu, "<redacted-academy-id>")
    .replace(/\b[A-Z2-7]{20,}\b/gu, "<redacted-secret>")
    .replace(/((?:password|passphrase|pin|totp|recovery[ -]?(?:code|key)?|backup[ -]?code|secret)\s*(?:=|:|is)\s*)[^&\s,;]+/giu, "$1<redacted>")
    .replace(/((?:[?&]|\b)(?:auth|code|email|key|password|pin|recovery|secret|session|token|totp)(?:[-_][a-z0-9_-]+)?=)[^&\s]+/giu, "$1<redacted>")
    .replace(/\b\d{6}\b/gu, "<redacted-six-digit-code>")
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
