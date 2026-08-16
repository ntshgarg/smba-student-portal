import { beforeEach, describe, expect, it, vi } from "vitest"

const getCurrentIdentity = vi.fn()
const getCoachAccessProfile = vi.fn()

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity },
}))
vi.mock("@/lib/auth/coach-access", () => ({
  getCoachAccessProfile,
  requireHeadAdminAccess: vi.fn(),
}))
vi.mock("react", () => ({
  cache: <Arguments extends unknown[], Result>(
    read: (...arguments_: Arguments) => Result,
  ) => {
    const results = new Map<string, Result>()
    return (...arguments_: Arguments) => {
      const key = JSON.stringify(arguments_)
      if (!results.has(key)) results.set(key, read(...arguments_))
      return results.get(key) as Result
    }
  },
}))

describe("coach request authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentIdentity.mockResolvedValue({
      academyId: "SMBA-COACH-01",
      firstName: "Sathiya",
      fullName: "Sathiya Moorthy",
      initials: "SM",
      role: "coach",
      subjectId: "coach-1",
    })
    getCoachAccessProfile.mockReturnValue({
      accessLevel: "head_admin",
      coachAccountId: "coach-1",
      joinedOn: "2026-01-01",
    })
  })

  it("reuses identity and access reads across nested layout and page guards", async () => {
    const { requireCoachPage } = await import("@/lib/auth/current-coach")

    await requireCoachPage()
    await requireCoachPage()

    expect(getCurrentIdentity).toHaveBeenCalledTimes(1)
    expect(getCoachAccessProfile).toHaveBeenCalledTimes(1)
  })
})
