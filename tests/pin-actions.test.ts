import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCurrentIdentity: vi.fn(),
  hasPinCredential: vi.fn(),
  redirect: vi.fn(),
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
  // setupPinAction now imports hasPinCredential (SEC-4). This factory replaces
  // the whole module, so anything the action imports and is not listed here
  // resolves to undefined and throws at call time.
  hasPinCredential: mocks.hasPinCredential,
  setPinCredential: mocks.setPinCredential,
  validatePin: (pin: string) => /^\d{6}$/u.test(pin) ? null : "Enter exactly 6 digits.",
}))
vi.mock("@/lib/auth/coach-access", () => ({
  getCoachAccessProfile: () => ({ accessLevel: "junior_coach" }),
}))

import { setupPinAction, skipPinSetupAction } from "@/app/auth/pin/actions"

function pinData(pin: string, confirmPin: string) {
  const formData = new FormData()
  formData.set("pin", pin)
  formData.set("confirmPin", confirmPin)
  return formData
}

describe("optional PIN setup", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ session: { createdAt: new Date() } })
    mocks.getCurrentIdentity.mockResolvedValue({ role: "player", subjectId: "player-one" })
    mocks.hasPinCredential.mockReturnValue(false)
    mocks.setPinCredential.mockResolvedValue({ created: true })
  })

  it("rejects non-six-digit PINs and confirmation mismatches before persistence", async () => {
    await expect(setupPinAction({ error: null, errorField: null }, pinData("12345", "12345")))
      .resolves.toEqual({ error: "Enter exactly 6 digits.", errorField: "pin" })
    await expect(setupPinAction({ error: null, errorField: null }, pinData("123456", "654321")))
      .resolves.toEqual({ error: "The PINs do not match.", errorField: "confirmPin" })
    expect(mocks.setPinCredential).not.toHaveBeenCalled()
  })

  it("persists a confirmed PIN and routes the player to their dashboard", async () => {
    await setupPinAction({ error: null, errorField: null }, pinData("123456", "123456"))
    expect(mocks.setPinCredential).toHaveBeenCalledWith({
      accountId: "player-one",
      pin: "123456",
    })
    expect(mocks.redirect).toHaveBeenCalledWith("/player")
  })

  it("skips credential creation and routes a assistant coach to the restricted workspace", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ role: "coach", subjectId: "junior-one" })
    await skipPinSetupAction()
    expect(mocks.setPinCredential).not.toHaveBeenCalled()
    expect(mocks.redirect).toHaveBeenCalledWith("/coach")
  })

  it("creates a mandatory platform-owner PIN and cannot skip it", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({
      role: "platform_admin",
      subjectId: "platform-owner",
    })
    await setupPinAction(
      { error: null, errorField: null },
      pinData("246810", "246810"),
    )
    expect(mocks.setPinCredential).toHaveBeenCalledWith({
      accountId: "platform-owner",
      pin: "246810",
    })
    expect(mocks.redirect).toHaveBeenCalledWith("/admin")

    mocks.redirect.mockClear()
    await skipPinSetupAction()
    expect(mocks.redirect).toHaveBeenCalledWith("/auth/pin/setup")
  })
})
