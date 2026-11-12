import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The smaller gaps around where a signed-in person is sent and what a refused
 * save tells them (M023, M025): each is a screen that pointed somewhere that
 * could not help.
 */

const mocks = vi.hoisted(() => ({
  getCoachAccessProfile: vi.fn(),
  getCurrentIdentity: vi.fn(),
  hasActiveSession: vi.fn(),
  hasPinCredential: vi.fn(() => false),
  redirect: vi.fn((destination: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${destination}`), {
      digest: `NEXT_REDIRECT;replace;${destination};307;`,
    })
  }),
  sessionFreshEnoughForPinSetup: vi.fn(),
  sessionOwesAuthenticatorSetup: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({}) }))
vi.mock("@/lib/data", () => ({
  sessionProvider: {
    getCurrentIdentity: mocks.getCurrentIdentity,
    hasActiveSession: mocks.hasActiveSession,
  },
}))
vi.mock("@/lib/auth/session", () => ({
  sessionOwesAuthenticatorSetup: mocks.sessionOwesAuthenticatorSetup,
}))
vi.mock("@/lib/auth/coach-access", () => ({
  getCoachAccessProfile: mocks.getCoachAccessProfile,
  requireHeadAdminAccess: vi.fn(),
}))
vi.mock("@/lib/auth/credential-service", () => ({ hasPinCredential: mocks.hasPinCredential }))
vi.mock("@/lib/auth/pin-setup-freshness", () => ({
  sessionFreshEnoughForPinSetup: mocks.sessionFreshEnoughForPinSetup,
}))
vi.mock("@/lib/auth/post-auth-destination", () => ({
  postAuthenticationDestination: () => "/coach",
}))
vi.mock("@/lib/training/changes", () => ({ ensureDueTrainingChangesApplied: vi.fn() }))
vi.mock("@/app/auth/pin/actions", () => ({ setupPinAction: vi.fn(), skipPinSetupAction: vi.fn() }))
vi.mock("@/app/login/actions", () => ({
  clearSession: vi.fn(),
  loginWithAcademyId: vi.fn(),
  loginWithPin: vi.fn(),
}))

const headCoach = {
  academyId: "SMBA-HC-0001",
  firstName: "Ishaan",
  fullName: "Ishaan Rao",
  initials: "IR",
  role: "coach" as const,
  subjectId: "head-coach",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentIdentity.mockResolvedValue(headCoach)
  mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "head_admin" })
  mocks.hasPinCredential.mockReturnValue(false)
  mocks.sessionFreshEnoughForPinSetup.mockResolvedValue(true)
  mocks.sessionOwesAuthenticatorSetup.mockResolvedValue(false)
})

describe("the PIN setup page", () => {
  async function render() {
    const { default: PinSetupPage } = await import("@/app/auth/pin/setup/page")
    return renderToStaticMarkup(await PinSetupPage() as ReactElement)
  }

  it("does not tell a first-time head coach their PIN was removed", async () => {
    const markup = await render()
    expect(markup).not.toContain("removed during password recovery")
    expect(markup).toContain("This account needs a PIN")
  })

  it("does not offer a form its action will refuse to an older sign-in", async () => {
    mocks.sessionFreshEnoughForPinSetup.mockResolvedValue(false)

    const markup = await render()
    expect(markup).not.toContain('name="pin"')
    expect(markup).toContain("sign in again to set it")
    // The way out is on the page itself.
    expect(markup).toContain("Sign out")
  })

  it("offers the form to a sign-in that has just proved a password", async () => {
    expect(await render()).toContain('name="pin"')
  })
})

describe("the sign-in page", () => {
  it("sends a head coach who walked away from authenticator setup back to it", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(null)
    mocks.sessionOwesAuthenticatorSetup.mockResolvedValue(true)
    const { default: LoginPage } = await import("@/app/login/page")

    await expect(LoginPage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("NEXT_REDIRECT:/auth/two-factor/setup")
  })

  it("shows the ordinary form to someone who is signed out", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(null)
    const { default: LoginPage } = await import("@/app/login/page")

    const markup = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }))
    expect(markup).toContain('name="academyId"')
  })
})

describe("a head-coach save refused because the identity is gone", () => {
  it("is an expired sign-in when no session remains", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(null)
    mocks.hasActiveSession.mockResolvedValue(false)
    const { requireHeadAdminAction } = await import("@/lib/auth/current-coach")

    await expect(requireHeadAdminAction()).rejects.toMatchObject({ code: "SESSION_EXPIRED" })
  })

  it("is cleared by signing in again when the head coach only owes an authenticator", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(null)
    mocks.hasActiveSession.mockResolvedValue(true)
    mocks.sessionOwesAuthenticatorSetup.mockResolvedValue(true)
    const { requireHeadAdminAction } = await import("@/lib/auth/current-coach")

    await expect(requireHeadAdminAction()).rejects.toMatchObject({ code: "SESSION_EXPIRED" })
  })

  it("is still a refusal for a live session the portal will not accept for other reasons", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(null)
    mocks.hasActiveSession.mockResolvedValue(true)
    const { requireHeadAdminAction } = await import("@/lib/auth/current-coach")

    await expect(requireHeadAdminAction()).rejects.toThrow("Head coach access is required.")
  })
})

describe("the head-coach-only notice", () => {
  it("is taken off the address once shown, keeping everything else", async () => {
    const { addressWithoutNotice } = await import("@/components/coach/coach-access-notice")

    expect(addressWithoutNotice("https://portal.example/coach?notice=head-coach-only#attendance"))
      .toBe("/coach#attendance")
    expect(addressWithoutNotice("https://portal.example/coach?notice=head-coach-only&tab=week"))
      .toBe("/coach?tab=week")
    expect(addressWithoutNotice("https://portal.example/coach?tab=week")).toBeNull()
  })
})

describe("a new mark after a refused save", () => {
  it("keeps the expired sign-in notice and its way out", async () => {
    const { feedbackAfterMark } = await import("@/lib/client/session-expiry")
    const expired = {
      leaveConfirmation: "Leave this date? Your marks are kept on this device.",
      message: "Staff attendance was not recorded because your sign-in expired.",
      signIn: { href: "/login", label: "Sign in" },
      tone: "error" as const,
    }

    expect(feedbackAfterMark(expired)).toBe(expired)
  })

  it("still clears any other notice, which the mark has made stale", async () => {
    const { feedbackAfterMark } = await import("@/lib/client/session-expiry")

    expect(feedbackAfterMark({ message: "Staff attendance saved", tone: "success" as const }))
      .toBeNull()
    expect(feedbackAfterMark(null)).toBeNull()
  })
})
