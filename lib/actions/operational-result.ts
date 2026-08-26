export type OperationalActionErrorCode =
  | "BUSINESS_RULE"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "SESSION_EXPIRED"

export type OperationalActionFailure = {
  ok: false
  code: OperationalActionErrorCode
  field?: string
  message: string
}

export type OperationalActionResult<T> =
  | { ok: true; data: T }
  | OperationalActionFailure

/**
 * An expected, coach-correctable operational failure. Authorization failures
 * and unexpected persistence/invariant errors must not use this class.
 *
 * `SESSION_EXPIRED` is the single authentication code, and it qualifies on the
 * same test the exclusion above is drawn from: a refused authorization has no
 * correction -- the same coach retries and is refused identically -- whereas an
 * expired session has exactly one, signing in again. Being refused head-coach
 * access stays a throw.
 */
export class OperationalActionError extends Error {
  readonly code: OperationalActionErrorCode
  readonly field?: string

  constructor(
    code: OperationalActionErrorCode,
    message: string,
    field?: string,
  ) {
    super(message)
    this.name = "OperationalActionError"
    this.code = code
    this.field = field
  }
}

export function operationalActionError(
  code: OperationalActionErrorCode,
  message: string,
  field?: string,
): never {
  throw new OperationalActionError(code, message, field)
}

export function operationalActionFailure(
  error: OperationalActionError,
): OperationalActionFailure {
  return {
    ok: false,
    code: error.code,
    field: error.field,
    message: error.message,
  }
}

/**
 * Sessions run on a fixed seven-day clock -- `disableSessionRefresh: true` with
 * `expiresIn` at `lib/auth/better-auth.ts:102-103` -- so a coach crosses the
 * expiry mid-register on a schedule rather than by exception.
 *
 * Thrown rather than returned, so a guard nobody has converted stays
 * fail-closed. The code is what a caller that does convert it puts on the wire,
 * because the error itself cannot carry the distinction: in a production build
 * React replaces anything thrown out of a server action with a fixed sentence
 * and a digest -- "The specific message is omitted in production builds to avoid
 * leaking sensitive details", in the vendored
 * react-server-dom-turbopack-client.browser.production.js -- discarding the
 * class, the message and every own property. Only a value survives the
 * boundary.
 */
export class SessionExpiredError extends OperationalActionError {
  constructor() {
    super(
      "SESSION_EXPIRED",
      "Your sign-in expired. Sign in again to continue.",
    )
    this.name = "SessionExpiredError"
  }
}

/**
 * The wire form of the error above, narrowed to the one code it can carry.
 *
 * A guard conversion is the only producer and it converts nothing else, so a
 * caller widened to admit this value learns that its session can expire without
 * also being told to handle the four operational codes a guard cannot raise.
 * That matters because the actions this reaches return domain results of their
 * own -- `MemberMutationResult`, `ReportMutationResult`, `FinanceActionResult`
 * -- whose own code unions stay untouched: an expiry joins the result union as
 * a separate member rather than being folded into any domain code union.
 */
export type SessionExpiredFailure = OperationalActionFailure & {
  code: "SESSION_EXPIRED"
}
