import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const getCurrentIdentity = vi.fn()
const getCoachAccessProfile = vi.fn()
const redirect = vi.fn()

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ redirect }))
vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity },
}))
vi.mock("@/lib/auth/coach-access", () => ({
  getCoachAccessProfile,
  requireHeadAdminAccess: vi.fn(),
}))
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
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
  }
})

const identity = {
  academyId: "SMBA-JC-0001",
  firstName: "Arun",
  fullName: "Arun Kumar",
  initials: "AK",
  role: "coach",
  subjectId: "coach-junior",
}

describe("head coach access denial", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getCurrentIdentity.mockResolvedValue(identity)
  })

  it("tells the dashboard to explain the refusal instead of bouncing silently", async () => {
    getCoachAccessProfile.mockReturnValue({
      accessLevel: "junior_coach",
      coachAccountId: "coach-junior",
      joinedOn: "2026-01-01",
    })

    const { HEAD_COACH_ONLY_NOTICE, requireHeadAdminPage } = await import(
      "@/lib/auth/current-coach"
    )
    await requireHeadAdminPage()

    expect(redirect).toHaveBeenCalledWith(`/coach?notice=${HEAD_COACH_ONLY_NOTICE}`)
    // A bare /coach is the silent bounce this replaces.
    expect(redirect).not.toHaveBeenCalledWith("/coach")
  })

  it("leaves a head coach alone", async () => {
    getCoachAccessProfile.mockReturnValue({
      accessLevel: "head_admin",
      coachAccountId: "coach-head",
      joinedOn: "2026-01-01",
    })

    const { requireHeadAdminPage } = await import("@/lib/auth/current-coach")
    await requireHeadAdminPage()

    expect(redirect).not.toHaveBeenCalled()
  })

  it("states why the page was refused and where the coach ended up", async () => {
    const { CoachAccessNotice } = await import(
      "@/components/coach/coach-access-notice"
    )
    const html = renderToStaticMarkup(<CoachAccessNotice />)

    expect(html).toContain("Head coach access only")
    expect(html).toContain("not part of the assistant coach workspace")
    expect(html).toContain("back on your dashboard")
    // Announced to assistive technology rather than only painted.
    expect(html).toContain('role="status"')
  })

  it("keeps the redirect flag and the dashboard's expected flag in step", async () => {
    const { HEAD_COACH_ONLY_NOTICE } = await import("@/lib/auth/current-coach")
    const page = await import("node:fs").then(({ readFileSync }) =>
      readFileSync("app/coach/page.tsx", "utf8"),
    )

    expect(HEAD_COACH_ONLY_NOTICE).toBe("head-coach-only")
    expect(page).toContain("HEAD_COACH_ONLY_NOTICE")
    expect(page).toContain("CoachAccessNotice")
  })
})
