import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { trustedDeviceDatabaseHooks } = await import("@/lib/auth/second-factor-reset")

const DAY = 24 * 60 * 60 * 1000

function trustRow(expiresAt: Date) {
  return {
    expiresAt,
    identifier: "trust-device-sha256:abc",
    value: "head-coach",
  }
}

describe("the 30-day trust clamp", () => {
  it("holds a renewal to the expiry it replaces", async () => {
    const request = {}
    const firstGiven = new Date(Date.now() + 5 * DAY)
    await trustedDeviceDatabaseHooks.verification.delete.before(trustRow(firstGiven), request)
    await expect(trustedDeviceDatabaseHooks.verification.create.before(
      trustRow(new Date(Date.now() + 30 * DAY)),
      request,
    )).resolves.toEqual({ data: { expiresAt: firstGiven } })
  })

  it("ignores the library's cleanup of a trust that has already run out", async () => {
    // A head coach's laptop trust expired yesterday; ticking "Trust this
    // device" on a new phone in a request that also cleans that row up must
    // still give the phone its full 30 days.
    const request = {}
    await trustedDeviceDatabaseHooks.verification.delete.before(
      trustRow(new Date(Date.now() - DAY)),
      request,
    )
    await expect(trustedDeviceDatabaseHooks.verification.create.before(
      trustRow(new Date(Date.now() + 30 * DAY)),
      request,
    )).resolves.toBeUndefined()
  })
})
