/**
 * SEC-4 — a server action is a public endpoint.
 *
 * /auth/pin/setup already refuses a preview session and an account that
 * already holds a PIN (app/auth/pin/setup/page.tsx:21-27), but setupPinAction
 * is reachable without that page ever rendering: its action id is a build-time
 * constant in the public client chunk. setPinCredential is an upsert, and
 * signInPin mints a *full* session from Academy ID + PIN, so an unguarded
 * overwrite is a durable account takeover that surviving a password change and
 * a session revocation does not undo.
 *
 * These cases assert the action re-states the page's preconditions itself.
 * The redirect mock throws with a `digest`, exactly as next/navigation does,
 * so a guard that "redirects" but then falls through still fails here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCoachAccessProfile: vi.fn(),
  getCurrentIdentity: vi.fn(),
  hasPinCredential: vi.fn(),
  redirect: vi.fn((destination: string) => {
    const error = new Error(`NEXT_REDIRECT:${destination}`) as Error & { digest: string }
    error.digest = `NEXT_REDIRECT;push;${destination};307;`
    throw error
  }),
  setPinCredential: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
// setupPinAction reads the session's age: minting a first PIN is a
// session-only operation, so it must be a session that just proved a credential
// rather than a cookie someone kept.
vi.mock("@/lib/auth/better-auth", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } }),
}))
vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity },
}))
vi.mock("@/lib/auth/credential-service", () => ({
  hasPinCredential: mocks.hasPinCredential,
  setPinCredential: mocks.setPinCredential,
  validatePin: (pin: string) => /^\d{6}$/u.test(pin) ? null : "Enter exactly 6 digits.",
}))
vi.mock("@/lib/auth/coach-access", () => ({
  getCoachAccessProfile: mocks.getCoachAccessProfile,
}))

import { setupPinAction, skipPinSetupAction } from "@/app/auth/pin/actions"

const initialState = { error: null, errorField: null } as const

function pinData(pin: string) {
  const formData = new FormData()
  formData.set("pin", pin)
  formData.set("confirmPin", pin)
  return formData
}

describe("PIN setup is first-time only", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ session: { createdAt: new Date() } })
    mocks.getCurrentIdentity.mockResolvedValue({ role: "player", subjectId: "player-one" })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "junior_coach" })
    mocks.hasPinCredential.mockReturnValue(false)
    mocks.setPinCredential.mockResolvedValue({ created: true })
  })

  it("refuses to overwrite an existing sign-in credential", async () => {
    mocks.hasPinCredential.mockReturnValue(true)

    await expect(setupPinAction(initialState, pinData("123456")))
      .rejects.toThrow("NEXT_REDIRECT:/player")

    expect(mocks.hasPinCredential).toHaveBeenCalledWith("player-one")
    expect(mocks.setPinCredential).not.toHaveBeenCalled()
  })

  it("checks the credential before it reads the submitted PIN", async () => {
    mocks.hasPinCredential.mockReturnValue(true)
    mocks.getCurrentIdentity.mockResolvedValue({ role: "coach", subjectId: "head-one" })

    // A malformed PIN would normally come back as a validation message. The
    // guard has to win, or the action leaks whether validation ran at all.
    await expect(setupPinAction(initialState, pinData("nope")))
      .rejects.toThrow("NEXT_REDIRECT:/coach")

    expect(mocks.setPinCredential).not.toHaveBeenCalled()
  })

  it("sends the platform owner back to the admin workspace, not to a rewrite", async () => {
    mocks.hasPinCredential.mockReturnValue(true)
    mocks.getCurrentIdentity.mockResolvedValue({
      role: "platform_admin",
      subjectId: "platform-owner",
    })

    await expect(setupPinAction(initialState, pinData("246810")))
      .rejects.toThrow("NEXT_REDIRECT:/admin")

    expect(mocks.setPinCredential).not.toHaveBeenCalled()
  })

  it("still performs a genuine first-time setup", async () => {
    await expect(setupPinAction(initialState, pinData("123456")))
      .rejects.toThrow("NEXT_REDIRECT:/player")

    expect(mocks.setPinCredential).toHaveBeenCalledWith({
      accountId: "player-one",
      pin: "123456",
    })
  })
})

describe("PIN setup refuses an admin preview session", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ session: { createdAt: new Date() } })
    mocks.getCurrentIdentity.mockResolvedValue({
      previewMode: true,
      role: "player",
      subjectId: "player-one",
    })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "junior_coach" })
    mocks.hasPinCredential.mockReturnValue(false)
    mocks.setPinCredential.mockResolvedValue({ created: true })
  })

  it("will not mint a sign-in credential for the account being previewed", async () => {
    await expect(setupPinAction(initialState, pinData("123456")))
      .rejects.toThrow("NEXT_REDIRECT:/admin")

    expect(mocks.setPinCredential).not.toHaveBeenCalled()
    // The preview check precedes the credential read: a read-only preview
    // session has no business querying the previewed account's PIN state.
    expect(mocks.hasPinCredential).not.toHaveBeenCalled()
  })

  it("routes the skip control back to the admin workspace too", async () => {
    await expect(skipPinSetupAction()).rejects.toThrow("NEXT_REDIRECT:/admin")

    expect(mocks.setPinCredential).not.toHaveBeenCalled()
  })
})

describe("a stolen cookie cannot install a PIN", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue({ role: "player", subjectId: "player-one" })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "junior_coach" })
    mocks.hasPinCredential.mockReturnValue(false)
    mocks.setPinCredential.mockResolvedValue({ created: true })
  })

  it("refuses to mint a first PIN on a session that did not just prove a credential", async () => {
    /*
     * A PIN is a complete sign-in factor and this action asks for no password.
     * What made that defensible was only that it refuses while a PIN exists --
     * and that broke the moment another session-only action removed one: the
     * thief deleted the victim's PIN and minted their own, which then signed in
     * from a client holding no cookie and no password.
     */
    mocks.getSession.mockResolvedValue({
      session: { createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    })

    await expect(setupPinAction({ error: null, errorField: null }, pinData("246810")))
      .resolves.toEqual({ error: "Sign in again to set a PIN.", errorField: null })
    expect(mocks.setPinCredential).not.toHaveBeenCalled()
  })

  it("refuses when the session cannot be read at all", async () => {
    mocks.getSession.mockResolvedValue(null)

    await expect(setupPinAction({ error: null, errorField: null }, pinData("246810")))
      .resolves.toMatchObject({ error: "Sign in again to set a PIN." })
    expect(mocks.setPinCredential).not.toHaveBeenCalled()
  })
})
