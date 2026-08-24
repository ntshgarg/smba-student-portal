import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SessionIdentity } from "@/lib/auth/identity"

const mocks = vi.hoisted(() => ({
  getCurrentIdentity: vi.fn(),
}))

vi.mock("@/lib/data", () => ({
  sessionProvider: {
    getCurrentIdentity: mocks.getCurrentIdentity,
  },
}))

import { GET, runtime } from "@/app/api/session-summary/route"

const identity: SessionIdentity = {
  academyId: "SMBA#0002",
  firstName: "Aarav",
  fullName: "Aarav Bhat",
  initials: "AB",
  role: "player",
  subjectId: "player-account",
}

function expectPrivateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store")
  expect(response.headers.get("vary")).toBe("Cookie")
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
}

describe("public session summary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue(null)
  })

  it("uses the Node runtime and returns a private anonymous summary", async () => {
    const response = await GET()

    expect(runtime).toBe("nodejs")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "anonymous" })
    expectPrivateResponse(response)
  })

  it.each(["player", "coach"] as const)(
    "returns only display-safe fields for an authenticated %s",
    async (role) => {
      mocks.getCurrentIdentity.mockResolvedValueOnce({ ...identity, role })

      const response = await GET()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        status: "authenticated",
        account: {
          initials: "AB",
          name: "Aarav Bhat",
          role,
        },
      })
      expectPrivateResponse(response)
    },
  )

  it("returns a generic unavailable summary when session lookup fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.getCurrentIdentity.mockRejectedValueOnce(
      new Error("SQLITE_CANTOPEN /private/database/path token=secret"),
    )

    const response = await GET()
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(JSON.parse(body)).toEqual({ status: "unavailable" })
    expect(body).not.toContain("SQLITE_CANTOPEN")
    expect(body).not.toContain("token=secret")
    // The cause reaches the log so the failure is diagnosable, but the token in
    // it does not.
    expect(consoleError).toHaveBeenCalledWith(
      "Session summary lookup failed.",
      { cause: expect.stringContaining("SQLITE_CANTOPEN") },
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("token=secret")
    expectPrivateResponse(response)
    consoleError.mockRestore()
  })
})
