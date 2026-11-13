
import { beforeEach, describe, expect, it, vi } from "vitest"

const { reportClientError } = vi.hoisted(() => ({ reportClientError: vi.fn() }))
vi.mock("@/lib/telemetry/report-client-error", () => ({ reportClientError }))

import { SESSION_EXPIRED_DIGEST, SessionExpiredError } from "@/lib/actions/operational-result"
import {
  SaveTimeoutError,
  classifyNetworkFailure,
  describeSaveFailure,
  isSessionExpiry,
  withSaveDeadline,
} from "@/lib/client/network-failure"

beforeEach(() => {
  reportClientError.mockClear()
})

const attendanceCopy = {
  retained: "Your marks are still on screen",
  subject: "Attendance",
}

describe("classifyNetworkFailure", () => {
  it.each([
    ["Chrome", "Failed to fetch"],
    ["Firefox", "NetworkError when attempting to fetch resource."],
    ["Safari", "Load failed"],
  ])("treats the %s fetch rejection as a network failure", (_browser, message) => {
    expect(classifyNetworkFailure(new TypeError(message), true)).toBe("unreachable")
    expect(classifyNetworkFailure(new TypeError(message), false)).toBe("offline")
  })

  it("recognises a TypeError that crossed a realm boundary", () => {
    const foreign = new Error("Failed to fetch")
    foreign.name = "TypeError"

    expect(classifyNetworkFailure(foreign, true)).toBe("unreachable")
  })

  it("does not claim a network failure for a server-thrown error", () => {
    expect(classifyNetworkFailure(new Error("Attendance contains duplicate changes."), true))
      .toBeNull()
    expect(classifyNetworkFailure(new RangeError("index out of range"), false)).toBeNull()
    expect(classifyNetworkFailure("Failed to fetch", false)).toBeNull()
  })

  it.each([
    ["Chrome", "Cannot read properties of undefined (reading 'id')"],
    ["Safari", "undefined is not an object (evaluating 'charge.revision')"],
    ["Firefox", "can't access property \"id\", charge is undefined"],
    ["any", "allocations.map is not a function"],
  ])("does not blame the connection for a %s bug in the page", (_browser, message) => {
    expect(classifyNetworkFailure(new TypeError(message), true)).toBeNull()
  })

  it("does not mistake a deadline for a network failure", () => {
    expect(classifyNetworkFailure(new SaveTimeoutError(), false)).toBeNull()
  })
})

describe("withSaveDeadline", () => {
  it("resolves with the save result when the save settles first", async () => {
    vi.useFakeTimers()
    try {
      await expect(withSaveDeadline(Promise.resolve({ ok: true }), 20_000))
        .resolves.toEqual({ ok: true })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("propagates a save rejection without relabelling it", async () => {
    vi.useFakeTimers()
    try {
      await expect(withSaveDeadline(Promise.reject(new TypeError("Load failed")), 20_000))
        .rejects.toBeInstanceOf(TypeError)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects with SaveTimeoutError once the deadline passes", async () => {
    vi.useFakeTimers()
    try {
      const neverSettles = new Promise<never>(() => {})
      const raced = withSaveDeadline(neverSettles, 20_000)
      const assertion = expect(raced).rejects.toBeInstanceOf(SaveTimeoutError)

      await vi.advanceTimersByTimeAsync(19_999)
      await vi.advanceTimersByTimeAsync(1)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps a later rejection from the abandoned save handled", async () => {
    const abandoned = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new TypeError("Failed to fetch")), 20)
    })

    await expect(withSaveDeadline(abandoned, 5)).rejects.toBeInstanceOf(SaveTimeoutError)
    // An unhandled rejection here would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
})

describe("describeSaveFailure", () => {
  it("states the offline cause, the retained work and the next step", () => {
    expect(describeSaveFailure({
      ...attendanceCopy,
      error: new TypeError("Failed to fetch"),
      isOnline: false,
    })).toEqual({
      kind: "offline",
      message: "Attendance was not confirmed because this device is offline,"
        + " so it may or may not have gone through."
        + " Your marks are still on screen."
        + " Try again when the connection returns.",
      offerRetry: true,
    })
  })

  /*
   * The same rejection arrives when the server finished and only the reply was
   * lost, so a dropped connection is never reported as "could not be saved".
   */
  it("does not assert the device is offline, or that nothing was saved", () => {
    const description = describeSaveFailure({
      ...attendanceCopy,
      error: new TypeError("Load failed"),
      isOnline: true,
    })
    expect(description).toEqual({
      kind: "unreachable",
      message: "Attendance was not confirmed because the connection dropped,"
        + " so it may or may not have gone through."
        + " Your marks are still on screen."
        + " Check the connection and try again.",
      offerRetry: true,
    })
    expect(description.message).not.toContain("could not be saved")
  })

  it("swaps a claim about the academy for a way to check, and offers no blind retry", () => {
    expect(describeSaveFailure({
      error: new TypeError("Failed to fetch"),
      isOnline: true,
      retained: "The member is still active",
      subject: "The member archive",
      unconfirmed: "Check the connection, then reload the page to see whether the member was archived",
    })).toEqual({
      kind: "unreachable",
      message: "The member archive was not confirmed because the connection dropped,"
        + " so it may or may not have gone through."
        + " Check the connection, then reload the page to see whether the member was archived.",
      offerRetry: false,
    })
  })

  /*
   * M025. Only the two registers turned the guard's expiry into a value; every
   * other save threw it, and production React strips a throw to a fixed
   * sentence -- so a coach recording a payment on day eight saw a generic
   * failure. The digest is the part that survives.
   */
  it("tells the coach an expired sign-in is why, and how to keep the work", () => {
    const expired = Object.assign(
      new Error("An error occurred in the Server Components render."),
      { digest: SESSION_EXPIRED_DIGEST },
    )
    expect(describeSaveFailure({
      error: expired,
      retained: "The payment details are still on screen",
      subject: "The payment",
    })).toEqual({
      kind: "session-expired",
      message: "The payment did not go through because your sign-in has expired."
        + " The payment details are still on screen."
        + " Sign in again in a new tab, then come back here and try again.",
      offerRetry: false,
      signIn: { href: "/login", label: "Sign in in a new tab", newTab: true },
    })
  })

  it("gives the expired-sign-in error the guard throws the digest the browser reads", () => {
    const error = new SessionExpiredError()
    expect(error.digest).toBe(SESSION_EXPIRED_DIGEST)
    expect(isSessionExpiry(error)).toBe(true)
    expect(isSessionExpiry(new Error("Your sign-in expired."))).toBe(false)
  })

  /*
   * A server fault can come after the write committed -- an action that saves
   * and then fails to reload what it saved -- so it is not called a failure.
   */
  it("puts plain advice where a server fault would show React's placeholder", () => {
    const serverFault = Object.assign(
      new Error("An error occurred in the Server Components render. The specific message is"
        + " omitted in production builds to avoid leaking sensitive details."),
      { digest: "2410981234" },
    )
    const description = describeSaveFailure({ ...attendanceCopy, error: serverFault, isOnline: true })
    expect(description).toEqual({
      kind: "unknown",
      message: "Attendance ran into an unexpected problem, so it may or may not have gone"
        + " through. Your marks are still on screen."
        + " Try again, and if it keeps happening, reload the page.",
      offerRetry: false,
    })
    expect(description.message).not.toContain("could not be saved")
    expect(reportClientError).toHaveBeenCalledOnce()
  })

  it("asks the coach to look first after a server fault where the academy may have changed", () => {
    expect(describeSaveFailure({
      error: Object.assign(new Error("omitted"), { digest: "998877" }),
      retained: "No fees have been issued",
      subject: "The monthly fee issue",
      unconfirmed: "Reload the page to see whether the fees were issued before trying again",
    })).toEqual({
      kind: "unknown",
      message: "The monthly fee issue ran into an unexpected problem, so it may or may not have"
        + " gone through. Reload the page to see whether the fees were issued before trying again.",
      offerRetry: false,
    })
  })

  it("does not promise a deadline retry is safe where the academy may have changed", () => {
    expect(describeSaveFailure({
      error: new SaveTimeoutError(),
      retained: "No fees have been issued",
      subject: "The monthly fee issue",
      unconfirmed: "Reload the page to see whether the fees were issued before trying again",
    })).toEqual({
      kind: "timeout",
      message: "The monthly fee issue was not confirmed in time, so it may or may not have gone"
        + " through. Reload the page to see whether the fees were issued before trying again.",
      offerRetry: false,
    })
  })

  it("reports a bug in the page instead of blaming the connection", () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'revision')")
    const description = describeSaveFailure({ ...attendanceCopy, error: bug, isOnline: true })

    expect(description.kind).toBe("unknown")
    expect(description.offerRetry).toBe(false)
    expect(description.message).not.toContain("connection")
    expect(reportClientError).toHaveBeenCalledWith({
      boundary: "window",
      error: bug,
      eventType: "unhandled_rejection",
    })
  })

  it("reports a deadline as an unknown outcome rather than a failure", () => {
    const description = describeSaveFailure({
      ...attendanceCopy,
      error: new SaveTimeoutError(),
      isOnline: true,
    })

    expect(description).toEqual({
      kind: "timeout",
      message: "Attendance was not confirmed in time and may or may not have been recorded."
        + " Your marks are still on screen."
        + " Saving again is safe and will confirm the result.",
      offerRetry: true,
    })
    expect(description.message).not.toContain("could not be saved")
  })

  it("names the staff subject in the deadline copy", () => {
    expect(describeSaveFailure({
      error: new SaveTimeoutError(),
      isOnline: true,
      retained: "Your marks are still on screen",
      subject: "Staff attendance",
    }).message).toBe(
      "Staff attendance was not confirmed in time and may or may not have been recorded."
      + " Your marks are still on screen."
      + " Saving again is safe and will confirm the result.",
    )
  })

  it("recognises a deadline error that crossed a realm boundary", () => {
    const foreign = new Error("The save was not confirmed in time")
    foreign.name = "SaveTimeoutError"

    expect(describeSaveFailure({ ...attendanceCopy, error: foreign }).kind).toBe("timeout")
  })

  /*
   * Next.js raises a plain Error of its own for a reply it cannot read -- a
   * platform timeout page, a proxy's JSON 403 -- and a timeout can arrive after
   * the write landed. Its sentence is not for coaches and says nothing of that.
   */
  it.each([
    ["Next's unreadable-reply error", new Error("An unexpected response was received from the server.")],
    ["a text/plain error page", new Error("FUNCTION_INVOCATION_TIMEOUT")],
    ["a thrown value that is not an Error", "boom"],
  ])("does not show %s word for word", (_case, error) => {
    expect(describeSaveFailure({ ...attendanceCopy, error, isOnline: true })).toEqual({
      kind: "unknown",
      message: "Attendance ran into an unexpected problem, so it may or may not have gone"
        + " through. Your marks are still on screen."
        + " Try again, and if it keeps happening, reload the page.",
      offerRetry: false,
    })
  })
})
