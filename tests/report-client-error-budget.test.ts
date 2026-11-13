import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sendBeacon = vi.fn(() => true)

describe("browser fault report budget", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-13T04:00:00.000Z"))
    sendBeacon.mockClear()
    vi.stubGlobal("window", { location: { pathname: "/coach" } })
    vi.stubGlobal("navigator", { sendBeacon })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("sends again after an hour once eight faults have used the budget", async () => {
    const { reportClientError } = await import("@/lib/telemetry/report-client-error")
    const fault = (n: number) => reportClientError({
      boundary: "window",
      error: new Error(`fault ${n}`),
    })

    for (let n = 1; n <= 9; n += 1) fault(n)
    expect(sendBeacon).toHaveBeenCalledTimes(8)

    vi.advanceTimersByTime(60 * 60_000)
    fault(10)
    expect(sendBeacon).toHaveBeenCalledTimes(9)
  })
})
