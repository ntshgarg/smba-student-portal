import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCoachAccessProfile: vi.fn(),
  getCurrentIdentity: vi.fn(),
  removePinCredential: vi.fn(),
  setPinCredential: vi.fn(),
  verifyCurrentPasswordAttempt: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("@/lib/auth/better-auth", () => ({ auth: { api: {} } }))
vi.mock("@/lib/auth/account-service", () => ({
  approveRegistration: vi.fn(),
  rejectRegistration: vi.fn(),
}))
vi.mock("@/lib/auth/coach-access", () => ({
  getCoachAccessProfile: mocks.getCoachAccessProfile,
}))
vi.mock("@/lib/auth/credential-service", () => ({
  hasPinCredential: vi.fn(),
  removePinCredential: mocks.removePinCredential,
  setPinCredential: mocks.setPinCredential,
  validateNewPassword: vi.fn(),
  validatePin: vi.fn(),
  verifyCurrentPasswordAttempt: mocks.verifyCurrentPasswordAttempt,
}))
vi.mock("@/lib/auth/security-context", () => ({
  requestSecurityContext: vi.fn(() => ({ ipHash: "ip", userAgent: "test" })),
  writeAuthSecurityEvent: vi.fn(),
}))
vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity },
}))

import { removePinAction, savePinAction } from "@/app/account/security/actions"

function passwordData() {
  const formData = new FormData()
  formData.set("currentPassword", "Current secure password!")
  return formData
}

describe("role-aware PIN management", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyCurrentPasswordAttempt.mockResolvedValue("verified")
  })

  it("prevents the head coach from removing the mandatory PIN", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ role: "coach", subjectId: "head-one" })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "head_admin" })

    await expect(removePinAction({ error: null, success: null }, passwordData()))
      .resolves.toEqual({ error: "The head-coach account requires a PIN.", success: null })
    expect(mocks.verifyCurrentPasswordAttempt).not.toHaveBeenCalled()
    expect(mocks.removePinCredential).not.toHaveBeenCalled()
  })

  it("rejects an empty PIN form before checking credentials", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ role: "player", subjectId: "player-one" })

    await expect(savePinAction({ error: null, success: null }, new FormData()))
      .resolves.toEqual({ error: "Enter your current password.", success: null })
    expect(mocks.verifyCurrentPasswordAttempt).not.toHaveBeenCalled()
    expect(mocks.setPinCredential).not.toHaveBeenCalled()
  })

  it("prevents the platform owner from removing the mandatory PIN", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({
      role: "platform_admin",
      subjectId: "platform-owner",
    })

    await expect(removePinAction({ error: null, success: null }, passwordData()))
      .resolves.toEqual({ error: "The platform-owner account requires a PIN.", success: null })
    expect(mocks.verifyCurrentPasswordAttempt).not.toHaveBeenCalled()
    expect(mocks.removePinCredential).not.toHaveBeenCalled()
  })

  it("keeps PIN removal available to a junior coach after password confirmation", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ role: "coach", subjectId: "junior-one" })
    mocks.getCoachAccessProfile.mockReturnValue({ accessLevel: "junior_coach" })

    await expect(removePinAction({ error: null, success: null }, passwordData()))
      .resolves.toEqual({
        error: null,
        success: "PIN login removed. Use your password to sign in.",
      })
    expect(mocks.removePinCredential).toHaveBeenCalledWith("junior-one")
  })
})
