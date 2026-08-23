export type NetworkFailureKind = "offline" | "unreachable"

export type SaveFailureKind = NetworkFailureKind | "timeout" | "unknown"

export type SaveFailureDescription = {
  kind: SaveFailureKind
  message: string
  offerRetry: boolean
}

function deviceIsOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false
}

/**
 * Raised when a save passes its deadline. It does not mean the save failed: the
 * server was never told to stop, so the write may still land afterwards. Only
 * `withSaveDeadline` throws this.
 */
export class SaveTimeoutError extends Error {
  constructor(message = "The save was not confirmed in time") {
    super(message)
    this.name = "SaveTimeoutError"
  }
}

/**
 * Rejects with `SaveTimeoutError` when `timeoutMs` elapses before `save`
 * settles.
 *
 * This is a deadline, NOT a cancellation. Next.js invokes a server action
 * through React's `callServer(actionId, actionArgs)`, which takes no options,
 * and the reducer behind it builds its own `fetch(url, { method, headers,
 * body })` with no `signal`. There is no seam to pass an `AbortSignal` through,
 * so `AbortSignal.timeout()` is unusable here and the request keeps running
 * after the deadline passes. Callers must therefore treat a timeout as an
 * unknown outcome rather than a failure.
 *
 * `Promise.race` subscribes to `save`, so a later rejection from the abandoned
 * request stays handled and never surfaces as an unhandled rejection.
 */
export function withSaveDeadline<T>(save: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SaveTimeoutError()), timeoutMs)
  })

  return Promise.race([save, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/**
 * A request that never reached the server rejects with a `TypeError` regardless
 * of wording: "Failed to fetch" (Chrome), "NetworkError when attempting to
 * fetch resource." (Firefox), "Load failed" (Safari). The constructor is the
 * stable signal across browsers, so the message is never inspected. `name` is
 * compared as well because an error crossing a realm boundary fails
 * `instanceof`. Anything else — including a server-thrown error — is not a
 * transport failure and returns `null`.
 *
 * `navigator.onLine` only reports whether a network interface exists, so it
 * cannot prove reachability. It is used solely to choose between the two
 * network messages, never to decide whether the failure was a network failure.
 */
export function classifyNetworkFailure(
  error: unknown,
  isOnline: boolean = deviceIsOnline(),
): NetworkFailureKind | null {
  const isTransportFailure = error instanceof TypeError
    || (error instanceof Error && error.name === "TypeError")
  if (!isTransportFailure) return null
  return isOnline ? "unreachable" : "offline"
}

function isSaveTimeout(error: unknown) {
  return error instanceof SaveTimeoutError
    || (error instanceof Error && error.name === "SaveTimeoutError")
}

/**
 * Turns a rejected save into operational copy. `subject` names what was being
 * saved, `retained` states what is still on screen, and `fallbackMessage`
 * covers a non-`Error` throw. Both sentences are supplied without trailing
 * punctuation.
 *
 * A timeout is deliberately never described as a failure, because the write may
 * have landed. Offline and unreachable are safe to call failures: the request
 * never reached the server, so nothing can have been recorded.
 */
export function describeSaveFailure({
  error,
  fallbackMessage,
  isOnline,
  retained,
  subject,
}: {
  error: unknown
  fallbackMessage: string
  isOnline?: boolean
  retained: string
  subject: string
}): SaveFailureDescription {
  if (isSaveTimeout(error)) {
    return {
      kind: "timeout",
      message: `${subject} was not confirmed in time and may or may not have been`
        + ` recorded. ${retained}. Saving again is safe and will confirm the result.`,
      offerRetry: true,
    }
  }

  const failure = classifyNetworkFailure(error, isOnline)
  if (!failure) {
    return {
      kind: "unknown",
      message: error instanceof Error ? error.message : fallbackMessage,
      offerRetry: false,
    }
  }

  const cause = failure === "offline"
    ? "this device is offline"
    : "the request did not complete"
  const nextStep = failure === "offline"
    ? "Try again when the connection returns"
    : "Check the connection and try again"

  return {
    kind: failure,
    message: `${subject} could not be saved because ${cause}. ${retained}. ${nextStep}.`,
    offerRetry: true,
  }
}
