import { sanitizeFailureText } from "@/lib/telemetry/redaction"

// The shared contract between the browser reporter and the route handler that
// stores a report. Every value that reaches the database passes through one of
// the normalizers below, so a hostile or buggy client cannot widen the payload:
// each field is either a fixed vocabulary, a masked route pattern, or a hash.
//
// This module must remain importable from a client component: no Node built-ins,
// no database access.

export const CLIENT_ERROR_REPORT_ENDPOINT = "/api/client-errors"

// Large enough for the fields below with room to spare, small enough that the
// endpoint cannot be used to push volume at the server.
export const MAX_CLIENT_ERROR_REPORT_BYTES = 2_048

const CLIENT_ERROR_REPORT_TYPES = ["client_error", "unhandled_rejection"] as const
export type ClientErrorReportType = (typeof CLIENT_ERROR_REPORT_TYPES)[number]

/** Which reporting site observed the failure. One entry per wired boundary. */
export const CLIENT_ERROR_BOUNDARIES = [
  "root",
  "global",
  "student",
  "coach",
  "coach_financials",
  "player_financials",
  "window",
] as const
export type ClientErrorBoundary = (typeof CLIENT_ERROR_BOUNDARIES)[number]

export type ClientErrorReport = {
  boundary: ClientErrorBoundary
  digest: string | null
  errorName: string
  eventType: ClientErrorReportType
  routePath: string
  /**
   * Redacted `name: message` text. It exists only to give the stored fingerprint
   * enough entropy to separate two different faults on the same route, and is
   * hashed and discarded by the route handler. It is never stored.
   */
  summary: string
}

const MAX_ROUTE_PATTERN_LENGTH = 240
const MAX_ROUTE_SEGMENTS = 6
const MAX_SUMMARY_LENGTH = 300

const MASKED_SEGMENT = ":id"
const TRUNCATED_SEGMENT = ":rest"

// A real SMBA route segment is lowercase letters and hyphens. Anything else --
// a player UUID, an Academy ID such as SMBA-PL-0004, a report id, a percent
// escape -- fails this test and is masked, so no identifier can reach the table
// through the route column.
const STATIC_ROUTE_SEGMENT = /^[a-z][a-z-]{0,31}$/u

// Next.js production digests are opaque decimal or hex strings. Framework
// control digests such as `NEXT_REDIRECT;push;/coach/players/<uuid>;307;` carry
// a resolved URL, so only the opaque shape is accepted.
const OPAQUE_DIGEST = /^[0-9a-f]{1,64}$/u

// Storing a free-text error name would reopen the hole this table exists to
// avoid, so an unrecognised name is recorded as "Error". The distinction is not
// lost: the raw name still feeds the hashed signature, so two different custom
// errors keep different fingerprints.
const REPORTABLE_ERROR_NAMES: ReadonlySet<string> = new Set([
  "AbortError",
  "AggregateError",
  "ChunkLoadError",
  "DOMException",
  "Error",
  "EvalError",
  "InvalidStateError",
  "NotAllowedError",
  "QuotaExceededError",
  "RangeError",
  "ReferenceError",
  "SaveTimeoutError",
  "SecurityError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "URIError",
])

/**
 * Reduces a pathname to a route pattern. Applying this to its own output is a
 * no-op, so the browser can mask before sending and the server can mask again
 * without trusting the browser to have done it.
 */
export function toRoutePattern(value: unknown): string {
  if (typeof value !== "string") return "/unknown"
  const pathname = value.split("?")[0].split("#")[0]
  if (!pathname.startsWith("/")) return "/unknown"

  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0) return "/"

  const masked = segments.slice(0, MAX_ROUTE_SEGMENTS).map((segment) => {
    if (segment === MASKED_SEGMENT || segment === TRUNCATED_SEGMENT) return segment
    const lowered = segment.toLowerCase()
    return STATIC_ROUTE_SEGMENT.test(lowered) ? lowered : MASKED_SEGMENT
  })
  if (segments.length > MAX_ROUTE_SEGMENTS) masked.push(TRUNCATED_SEGMENT)

  return `/${masked.join("/")}`.slice(0, MAX_ROUTE_PATTERN_LENGTH)
}

export function normalizeErrorName(value: unknown): string {
  return typeof value === "string" && REPORTABLE_ERROR_NAMES.has(value) ? value : "Error"
}

export function normalizeErrorDigest(value: unknown): string | null {
  if (typeof value !== "string") return null
  const digest = value.trim().toLowerCase()
  return OPAQUE_DIGEST.test(digest) ? digest : null
}

export function normalizeBoundary(value: unknown): ClientErrorBoundary | null {
  return CLIENT_ERROR_BOUNDARIES.find((boundary) => boundary === value) ?? null
}

export function normalizeReportType(value: unknown): ClientErrorReportType | null {
  return CLIENT_ERROR_REPORT_TYPES.find((eventType) => eventType === value) ?? null
}

/** Redacts and bounds the text that feeds the fingerprint. Never stored as text. */
export function redactReportSummary(value: unknown): string {
  if (typeof value !== "string") return ""
  return sanitizeFailureText(value)
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_SUMMARY_LENGTH)
}

/**
 * Reads what can be read from a thrown value without trusting it. A thrown
 * object may be a proxy whose getters throw, so every access is guarded.
 */
export function describeReportedError(error: unknown): {
  digest: string | null
  errorName: string
  summary: string
} {
  let rawName = "Error"
  let rawMessage = ""
  let rawDigest: unknown = null

  try {
    if (typeof error === "string") {
      rawMessage = error
    } else if (typeof error === "object" && error !== null) {
      const candidate = error as { digest?: unknown; message?: unknown; name?: unknown }
      if (typeof candidate.name === "string") rawName = candidate.name
      if (typeof candidate.message === "string") rawMessage = candidate.message
      rawDigest = candidate.digest
    }
  } catch {
    // A throwing getter must not cost us the rest of the report.
  }

  return {
    digest: normalizeErrorDigest(rawDigest),
    errorName: normalizeErrorName(rawName),
    summary: redactReportSummary(`${rawName}: ${rawMessage}`),
  }
}

/** The string the route handler hashes. Only its hash is ever stored. */
export function clientErrorSignature(report: ClientErrorReport): string {
  return [
    report.eventType,
    report.boundary,
    report.routePath,
    report.errorName,
    report.digest ?? "-",
    report.summary,
  ].join("|")
}

/** Narrows an untrusted request body, or returns null when it is not a report. */
export function parseClientErrorReport(value: unknown): ClientErrorReport | null {
  if (typeof value !== "object" || value === null) return null

  const candidate = value as Record<string, unknown>
  const boundary = normalizeBoundary(candidate.boundary)
  const eventType = normalizeReportType(candidate.eventType)
  if (!boundary || !eventType) return null

  return {
    boundary,
    digest: normalizeErrorDigest(candidate.digest),
    errorName: normalizeErrorName(candidate.errorName),
    eventType,
    routePath: toRoutePattern(candidate.routePath),
    summary: redactReportSummary(candidate.summary),
  }
}
