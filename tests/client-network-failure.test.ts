import { describe, expect, it } from "vitest"

import {
  classifyNetworkFailure,
  describeSaveFailure,
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
})

describe("describeSaveFailure", () => {
  it("states the offline cause, the retained work and the next step", () => {
    expect(describeSaveFailure({
      ...attendanceCopy,
      error: new TypeError("Failed to fetch"),
      isOnline: false,
    })).toEqual({
      isNetworkFailure: true,
      message: "Attendance could not be saved because this device is offline."
        + " Your marks are still on screen."
        + " Try again when the connection returns.",
    })
  })

  it("does not assert the device is offline when an interface exists", () => {
    expect(describeSaveFailure({
      ...attendanceCopy,
      error: new TypeError("Load failed"),
      isOnline: true,
    })).toEqual({
      isNetworkFailure: true,
      message: "Attendance could not be saved because the request did not complete."
        + " Your marks are still on screen."
        + " Check the connection and try again.",
    })
  })

  it("passes an unexpected error through without offering a retry", () => {
    expect(describeSaveFailure({
      ...attendanceCopy,
      error: new Error("The selected session is unavailable."),
      isOnline: false,
    })).toEqual({
      isNetworkFailure: false,
      message: "The selected session is unavailable.",
    })
  })

  it("falls back when the thrown value is not an Error", () => {
    expect(describeSaveFailure({
      ...attendanceCopy,
      error: "boom",
      isOnline: true,
    })).toEqual({
      isNetworkFailure: false,
      message: "Attendance could not be saved",
    })
  })
})
