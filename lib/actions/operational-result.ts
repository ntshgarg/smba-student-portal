export type OperationalActionErrorCode =
  | "BUSINESS_RULE"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "NOT_FOUND"

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
