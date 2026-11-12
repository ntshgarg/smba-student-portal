/**
 * The actions behind the emailed recovery links.
 *
 * Continue on the link's page is what uses the link up, and it hands this
 * browser its own pass. The pass cookie lives under the recovery path, so
 * removing it has to name that path -- a delete without it named "/" and left
 * the cookie in place. And a right code refused only because checks are paused
 * is answered "wait", not "not accepted".
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  claimPasswordRecovery: vi.fn<(token: string, options?: { intent?: string }) => string | null>(),
  completePasswordRecovery: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(() => ({ value: "browser-pass" })),
  cookieSet: vi.fn(),
  passwordRecoveryCodeChecksPaused: vi.fn(() => false),
  redirect: vi.fn((destination: string) => {
    const error = new Error(`NEXT_REDIRECT:${destination}`) as Error & { digest: string }
    error.digest = `NEXT_REDIRECT;push;${destination};307;`
    throw error
  }),
  submitAuthenticatorResetRequest: vi.fn(),
  verifyPasswordRecoverySecondFactor: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ delete: mocks.cookieDelete, get: mocks.cookieGet, set: mocks.cookieSet })),
  headers: vi.fn(async () => new Headers()),
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/auth/cookie-policy", () => ({ secureAuthCookiesRequired: () => true }))
vi.mock("@/lib/auth/credential-service", () => ({ validateNewPassword: () => null }))
vi.mock("@/lib/auth/security-context", () => ({
  requestSecurityContext: () => ({ ipHash: "ip", userAgent: "test" }),
}))
vi.mock("@/lib/auth/recovery-service", () => ({
  AUTHENTICATOR_RECOVERY_COOKIE: "smba_authenticator_recovery",
  claimPasswordRecovery: mocks.claimPasswordRecovery,
  completePasswordRecovery: mocks.completePasswordRecovery,
  PASSWORD_RECOVERY_LIFETIME_MS: 20 * 60 * 1000,
  passwordRecoveryCodeChecksPaused: mocks.passwordRecoveryCodeChecksPaused,
  RECOVERY_SESSION_COOKIE: "smba_password_recovery",
  requestPasswordRecovery: vi.fn(),
  submitAuthenticatorResetRequest: mocks.submitAuthenticatorResetRequest,
  verifyPasswordRecoverySecondFactor: mocks.verifyPasswordRecoverySecondFactor,
}))

import {
  completePasswordRecoveryAction,
  openPasswordRecoveryLinkAction,
  verifyRecoverySecondFactorAction,
} from "@/app/recover/actions"
import {
  openAuthenticatorRecoveryLinkAction,
  submitAuthenticatorRecoveryApprovalAction,
} from "@/app/auth/two-factor/recovery/actions"

function tokenForm(token: string) {
  const formData = new FormData()
  formData.set("token", token)
  return formData
}

describe("opening an emailed link", () => {
  beforeEach(() => vi.clearAllMocks())

  it("gives this browser its own pass, under the recovery path", async () => {
    mocks.claimPasswordRecovery.mockReturnValue("browser-pass")
    await expect(openPasswordRecoveryLinkAction(tokenForm("emailed-token")))
      .rejects.toThrow("NEXT_REDIRECT:/recover/reset")
    expect(mocks.claimPasswordRecovery).toHaveBeenCalledWith("emailed-token")
    expect(mocks.cookieSet).toHaveBeenCalledWith("smba_password_recovery", "browser-pass", expect.objectContaining({
      httpOnly: true,
      path: "/recover",
    }))
  })

  it("sends a used or expired link back to ask for another", async () => {
    mocks.claimPasswordRecovery.mockReturnValue(null)
    await expect(openPasswordRecoveryLinkAction(tokenForm("spent")))
      .rejects.toThrow("NEXT_REDIRECT:/recover?error=invalid")
    expect(mocks.cookieSet).not.toHaveBeenCalled()
  })

  it("opens an authenticator link only as an authenticator link", async () => {
    mocks.claimPasswordRecovery.mockReturnValue("browser-pass")
    await expect(openAuthenticatorRecoveryLinkAction(tokenForm("emailed-token")))
      .rejects.toThrow("NEXT_REDIRECT:/auth/two-factor/recovery?verified=1")
    expect(mocks.claimPasswordRecovery).toHaveBeenCalledWith("emailed-token", { intent: "authenticator" })
    expect(mocks.cookieSet).toHaveBeenCalledWith("smba_authenticator_recovery", "browser-pass", expect.objectContaining({
      path: "/auth/two-factor/recovery",
    }))
  })
})

describe("finishing with the pass", () => {
  beforeEach(() => vi.clearAllMocks())

  it("removes the pass cookie from the path it was set on", async () => {
    mocks.completePasswordRecovery.mockResolvedValue(true)
    const formData = new FormData()
    formData.set("password", "A brand new secure password")
    formData.set("confirmPassword", "A brand new secure password")
    await expect(completePasswordRecoveryAction({ error: null, errorField: null }, formData))
      .rejects.toThrow("NEXT_REDIRECT:/login?recovered=1")
    expect(mocks.cookieDelete).toHaveBeenCalledWith({ name: "smba_password_recovery", path: "/recover" })
  })

  it("removes the authenticator pass from the path it was set on", async () => {
    mocks.submitAuthenticatorResetRequest.mockReturnValue({ accountId: "head", requestId: "request" })
    await expect(submitAuthenticatorRecoveryApprovalAction({ error: null }, new FormData()))
      .rejects.toThrow("NEXT_REDIRECT:/auth/two-factor/recovery?requested=1")
    expect(mocks.cookieDelete).toHaveBeenCalledWith({
      name: "smba_authenticator_recovery",
      path: "/auth/two-factor/recovery",
    })
  })

  it("tells a coach to wait, not that a code is wrong, while checks are paused", async () => {
    mocks.verifyPasswordRecoverySecondFactor.mockResolvedValue(false)
    mocks.passwordRecoveryCodeChecksPaused.mockReturnValue(true)
    const formData = new FormData()
    formData.set("credential", "123456")
    const result = await verifyRecoverySecondFactorAction({ error: null }, formData)
    expect(result.error).toMatch(/^Too many codes were tried\. Wait 15 minutes/u)

    mocks.passwordRecoveryCodeChecksPaused.mockReturnValue(false)
    await expect(verifyRecoverySecondFactorAction({ error: null }, formData))
      .resolves.toEqual({ error: "That code was not accepted." })
  })
})
