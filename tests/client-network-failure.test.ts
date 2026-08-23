import { describe, expect, it, vi } from "vitest"

import {
  SaveTimeoutError,
  classifyNetworkFailure,
  describeSaveFailure,
  withSaveDeadline,
} from "@/lib/client/network-failure"

const attendanceCopy = {
  fallbackMessage: "Attendance could not be saved",
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
      message: "Attendance could not be saved because this device is offline."
        + " Your marks are still on screen."
        + " Try again when the connection returns.",
      offerRetry: true,
    })
  })

  it("does not assert the device is offline when an interface exists", () => {
    expect(describeSaveFailure({
      ...attendanceCopy,
      error: new TypeError("Load failed"),
      isOnline: true,
    })).toEqual({
      kind: "unreachable",
      message: "Attendance could not be saved because the request did not complete."
        + " Your marks are still on screen."
        + " Check the connection and try again.",
      offerRetry: true,
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
      fallbackMessage: "Staff attendance could not be saved",
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

  it("passes an unexpected error through without offering a retry", () => {
    expect(describeSaveFailure({
      ...attendanceCopy,
      error: new Error("The selected session is unavailable."),
      isOnline: false,
    })).toEqual({
      kind: "unknown",
      message: "The selected session is unavailable.",
      offerRetry: false,
    })
  })

  it("falls back when the thrown value is not an Error", () => {
    expect(describeSaveFailure({
      ...attendanceCopy,
      error: "boom",
      isOnline: true,
    })).toEqual({
      kind: "unknown",
      message: "Attendance could not be saved",
      offerRetry: false,
    })
  })
})
