import type { InlineNoticeAction } from "@/components/inline-notice"
import { SESSION_EXPIRED_DIGEST } from "@/lib/actions/operational-result"
import { reportClientError } from "@/lib/telemetry/report-client-error"

export type NetworkFailureKind = "offline" | "unreachable"

export type SaveFailureKind = NetworkFailureKind | "session-expired" | "timeout" | "unknown"

export type SaveFailureDescription = {
  kind: SaveFailureKind
  message: string
  offerRetry: boolean
  /** Set for an expired sign-in only: the way back, opened beside this tab. */
  signIn?: InlineNoticeAction
}

/**
 * The link an expired-sign-in notice can carry. It opens in a new tab because
 * the sentence beside it says to: leaving this tab for /login would throw away
 * the work the notice promises is still on screen.
 */
export const signInInNewTab: InlineNoticeAction = {
  href: "/login",
  label: "Sign in in a new tab",
  newTab: true,
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
 * The shapes a *bug* gives a `TypeError`, across the three engines: reading a
 * field of a missing value ("Cannot read properties of undefined", Safari's
 * "undefined is not an object", Firefox's "can't access property ... is
 * undefined"), calling or spreading the wrong thing ("is not a function", "is
 * not iterable"). A dropped request never reads like this, so a `TypeError`
 * that does is a fault to report, not a connection to blame.
 */
const programmingErrorShape = new RegExp([
  "cannot (read|set) propert",
  "cannot destructure",
  "can't access property",
  "is not an? (function|constructor|object)",
  "is not iterable",
  "is not defined",
  "is (undefined|null)\\b",
].join("|"), "iu")

/**
 * A request that did not complete rejects with a `TypeError` whose wording
 * varies: "Failed to fetch" (Chrome), "NetworkError when attempting to fetch
 * resource." (Firefox), "Load failed" (Safari). The constructor is the signal,
 * and `name` is compared as well because an error crossing a realm boundary
 * fails `instanceof`. The one thing the message is read for is to rule out a
 * bug in this page's own code, which is also a `TypeError` (see
 * `programmingErrorShape`). Anything else -- including a server-thrown error --
 * is not a transport failure and returns `null`.
 *
 * A transport failure does NOT mean the server never received the request.
 * The same rejection arrives when the connection drops after the server has
 * finished and before its reply gets back, so the caller cannot know whether
 * the save happened. `describeSaveFailure` words it that way.
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
  if (programmingErrorShape.test(error.message)) return null
  return isOnline ? "unreachable" : "offline"
}

function isSaveTimeout(error: unknown) {
  return error instanceof SaveTimeoutError
    || (error instanceof Error && error.name === "SaveTimeoutError")
}

function errorDigest(error: unknown) {
  if (typeof error !== "object" || error === null) return null
  const digest = (error as { digest?: unknown }).digest
  return typeof digest === "string" ? digest : null
}

/**
 * True when a save was refused because the coach's sign-in has run out. The
 * guard throws `SessionExpiredError`, whose digest is the one part of it that
 * survives the trip back to the browser (see `SESSION_EXPIRED_DIGEST`).
 */
export function isSessionExpiry(error: unknown) {
  return errorDigest(error) === SESSION_EXPIRED_DIGEST
}

/**
 * A fault in this page's own code, as opposed to anything the server said: an
 * error of its own kind (a `TypeError` from reading a missing field, say) with
 * no digest. A server action's throw arrives as a plain `Error` with one, and
 * Next.js's own complaint about a reply it could not read ("An unexpected
 * response was received from the server.") as a plain `Error` without.
 */
function isClientFault(error: unknown) {
  return error instanceof Error && error.name !== "Error" && errorDigest(error) === null
}

export function classifySaveFailure(
  error: unknown,
  isOnline?: boolean,
): SaveFailureKind {
  if (isSessionExpiry(error)) return "session-expired"
  if (isSaveTimeout(error)) return "timeout"
  return classifyNetworkFailure(error, isOnline) ?? "unknown"
}

/** The cause clause for a request whose reply never arrived. */
export function networkFailureCause(kind: NetworkFailureKind) {
  return kind === "offline" ? "this device is offline" : "the connection dropped"
}

/**
 * Turns a rejected save into operational copy. `subject` names what was being
 * saved, `retained` states what is still true when the save certainly did not
 * happen. Both are supplied without trailing punctuation.
 *
 * Nothing but an expired sign-in is described as a failure, because nothing
 * else can be known to have changed nothing. A dropped connection or a missed
 * deadline may have arrived after the server finished. So may a server fault --
 * the write can commit before something later in the action throws -- and so
 * may the plain `Error` Next.js raises for a reply it could not read, which is
 * what a platform timeout or a 5xx page becomes. None of those says whether the
 * save landed, and none is shown word for word: a production build replaces a
 * server's sentence with a fixed technical one, and Next's own is no better.
 *
 * Where `retained` describes the screen ("Your marks are still on screen") it
 * stays true either way and is kept, with "try again": callers that pass only
 * `retained` are the ones whose save is safe to repeat. Where it describes the
 * academy ("The member is still active") it would be false if the save landed,
 * so the caller supplies `unconfirmed` instead: what to do to find out, which
 * then replaces both `retained` and the generic next step, and no retry is
 * offered beside it.
 *
 * An expired sign-in is the one refusal known to have changed nothing -- the
 * guard throws before any write -- and the one whose fix is not on this screen.
 * The way back keeps the work: signing in from a new tab renews the cookie
 * this tab sends too, so the next save from here goes through.
 *
 * `subject` is a singular noun phrase ("The member update", not "The member
 * details"): the sentences around it say "was" and "it".
 */
export function describeSaveFailure({
  error,
  isOnline,
  retained,
  subject,
  unconfirmed,
}: {
  error: unknown
  isOnline?: boolean
  retained: string
  subject: string
  unconfirmed?: string
}): SaveFailureDescription {
  const kind = classifySaveFailure(error, isOnline)

  if (kind === "session-expired") {
    return {
      kind,
      message: `${subject} did not go through because your sign-in has expired. ${retained}.`
        + " Sign in again in a new tab, then come back here and try again.",
      offerRetry: false,
      signIn: signInInNewTab,
    }
  }

  if (kind === "timeout" && !unconfirmed) {
    return {
      kind,
      message: `${subject} was not confirmed in time and may or may not have been`
        + ` recorded. ${retained}. Saving again is safe and will confirm the result.`,
      offerRetry: true,
    }
  }

  if (kind === "unknown" && isClientFault(error)) {
    // The reporter is the only way a bug in a save button reaches anyone;
    // the coach can do nothing about it but try again.
    reportClientError({ boundary: "window", error, eventType: "unhandled_rejection" })
  }

  const cause = kind === "offline" || kind === "unreachable"
    ? `was not confirmed because ${networkFailureCause(kind)}`
    : kind === "timeout"
      ? "was not confirmed in time"
      : "ran into an unexpected problem"
  const nextStep = kind === "offline"
    ? "Try again when the connection returns"
    : kind === "unknown"
      ? "Try again, and if it keeps happening, reload the page"
      : "Check the connection and try again"

  return {
    kind,
    message: `${subject} ${cause}, so it may or may not have gone through. `
      + (unconfirmed ? `${unconfirmed}.` : `${retained}. ${nextStep}.`),
    // Where the coach has to look before acting, a button that acts is the
    // wrong thing to put beside the sentence telling them to look. An
    // unexpected fault gets no button either: the sentence says try again, and
    // a fault that repeats is better met by a reload than a second press.
    offerRetry: !unconfirmed && kind !== "unknown",
  }
}
