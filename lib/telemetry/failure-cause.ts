import { sanitizeFailureText } from "@/lib/telemetry/redaction"

// The one way SMBA turns a caught server-side error into text it is willing to
// write to a log. Callers that log a failure without a cause leave the incident
// undiagnosable; callers that log the raw error risk writing a session token or
// a recovery code into the log instead. This does both jobs at once.
//
// It only depends on the redaction module, so it stays as portable as that
// module is: no Node built-ins, no database access.

// A stack is worth having, a whole chain of them is not. CI keeps only the last
// 200 lines of the server log (`scripts/regression/sanitize-server-log.ts`), so
// an unbounded cause would push the surrounding request context out of the
// window that incident response actually reads.
const MAX_CAUSE_LENGTH = 1_000

/**
 * Redacts, flattens and bounds a caught value so it can be logged as the
 * `cause` of a failure.
 *
 * Flattened to one line on purpose: it keeps one failure to one log line, which
 * is what both the CI log window above and log ingestion expect.
 */
export function describeFailureCause(error: unknown): string {
  let raw: string

  // Reading a thrown value can itself throw -- a rejected promise may carry a
  // proxy whose getters fail, and `String()` runs a `toString` we do not own.
  // Losing the cause is acceptable here; losing the log line is not.
  try {
    raw = error instanceof Error
      ? error.stack ?? `${error.name}: ${error.message}`
      : String(error)
  } catch {
    raw = "unreadable thrown value"
  }

  return sanitizeFailureText(raw)
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_CAUSE_LENGTH)
}
