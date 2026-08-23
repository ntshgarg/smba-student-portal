export type NetworkFailureKind = "offline" | "unreachable"

export type SaveFailureDescription = {
  isNetworkFailure: boolean
  message: string
}

function deviceIsOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false
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

/**
 * Turns a rejected save into operational copy. `subject` names what was not
 * saved, `retained` states what is still on screen, and `fallbackMessage`
 * covers a non-`Error` throw. Both sentences are supplied without trailing
 * punctuation.
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
  const failure = classifyNetworkFailure(error, isOnline)
  if (!failure) {
    return {
      isNetworkFailure: false,
      message: error instanceof Error ? error.message : fallbackMessage,
    }
  }

  const cause = failure === "offline"
    ? "this device is offline"
    : "the request did not complete"
  const nextStep = failure === "offline"
    ? "Try again when the connection returns"
    : "Check the connection and try again"

  return {
    isNetworkFailure: true,
    message: `${subject} could not be saved because ${cause}. ${retained}. ${nextStep}.`,
  }
}
