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

/** Opens in a new tab so the work on this screen is kept. */
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

/** `TypeError` wordings that mean a bug in this page, not a dropped request. */
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
 * fails `instanceof`. A bug-shaped message (`programmingErrorShape`) and
 * anything else -- including a server-thrown error -- returns `null`.
 * The server may still have received the request.
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

/** True when the save was refused because the sign-in has run out. */
export function isSessionExpiry(error: unknown) {
  return errorDigest(error) === SESSION_EXPIRED_DIGEST
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
 * Turns a rejected save into operational copy. `subject` (singular, no trailing
 * punctuation) names what was being saved; `retained` states what is still on
 * screen. Only an expired sign-in is called a failure: anything else may have
 * landed. Where `retained` would be false if the save landed, the caller passes
 * `unconfirmed` (how to find out) instead, and no retry is offered.
 */
export function describeSaveFailure({
  error,
  isOnline,
  retained,
  subject,
  unconfirmed,
}: {
  error: unknown
  /** Ignored; kept so older callers still compile. */
  fallbackMessage?: string
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

  if (kind === "unknown") {
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
    offerRetry: !unconfirmed && kind !== "unknown",
  }
}
