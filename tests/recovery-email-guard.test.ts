/**
 * SEC-5 — the recovery-email enrolment pair is the unguarded twin.
 *
 * requestRecoveryEmailChange / confirmRecoveryEmailChange demand the current
 * password (plus a fresh second factor for privileged roles). The *enrolment*
 * pair asked for nothing, and the write it authorises is an upsert
 * (lib/auth/recovery-service.ts:329), so a signed-in browser left unattended
 * was enough to repoint a verified recovery address and then drive /recover
 * from anywhere. The setup page enforced the invariant
 * (app/account/recovery-email/setup/page.tsx:25); the action did not.
 *
 * Note on the confirm half: requestRecoveryEmailVerification writes only an
 * authEmailChallenges row. authRecoveryEmails is written by the confirm itself,
 * always with verifiedAt set — so getRecoveryEmail is still null when a genuine
 * first-time enrolment reaches the guard, which the last case here pins down.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  confirmRecoveryEmailVerification: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getRecoveryEmail: vi.fn(),
  redirect: vi.fn((destination: string) => {
    const error = new Error(`NEXT_REDIRECT:${destination}`) as Error & { digest: string }
    error.digest = `NEXT_REDIRECT;push;${destination};307;`
    throw error
  }),
  requestRecoveryEmailVerification: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/auth/credential-service", () => ({
  ACTIVATION_CLAIM_COOKIE: "activation",
  getActivationClaimStatus: vi.fn(),
  verifyCurrentPasswordAttempt: vi.fn(),
}))
vi.mock("@/lib/auth/cookie-policy", () => ({ secureAuthCookiesRequired: vi.fn() }))
vi.mock("@/lib/auth/recovery-service", () => ({
  confirmRecoveryEmailVerification: mocks.confirmRecoveryEmailVerification,
  getRecoveryEmail: mocks.getRecoveryEmail,
  HEAD_SETUP_EMAIL_COOKIE: "head-setup-email",
  recoverySubjectKeyForAccount: vi.fn((accountId: string) => accountId),
  recoverySubjectKeyForHeadSetup: vi.fn(),
  requestRecoveryEmailVerification: mocks.requestRecoveryEmailVerification,
  verifyFreshAccountSecondFactor: vi.fn(),
}))
vi.mock("@/lib/auth/initial-setup", () => ({
  HEAD_COACH_SETUP_COOKIE: "head-setup",
  headCoachSetupAvailable: vi.fn(),
  validHeadCoachSetupToken: vi.fn(),
}))
vi.mock("@/lib/auth/identity", () => ({ normalizeFullName: vi.fn() }))
vi.mock("@/lib/auth/security-context", () => ({
  requestSecurityContext: vi.fn(() => ({ ipHash: "ip", userAgent: "test" })),
}))
vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity },
}))
vi.mock("@/lib/auth/coach-access", () => ({ getCoachAccessProfile: vi.fn() }))

import {
  confirmCurrentRecoveryEmail,
  requestCurrentRecoveryEmail,
} from "@/app/account/recovery-email/actions"

const initialState = { email: "", error: null, sent: false }

function enrolmentData(email: string, code?: string) {
  const formData = new FormData()
  formData.set("email", email)
  if (code) formData.set("code", code)
  return formData
}

describe("recovery-email enrolment is first-time only", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue({ role: "player", subjectId: "player-one" })
    mocks.getRecoveryEmail.mockReturnValue(null)
    mocks.requestRecoveryEmailVerification.mockResolvedValue({ email: "new@example.com" })
    mocks.confirmRecoveryEmailVerification.mockReturnValue(true)
  })

  it("will not send an enrolment code to an account that already has an address", async () => {
    mocks.getRecoveryEmail.mockReturnValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      email: "parent@example.com",
      verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    })

    await expect(requestCurrentRecoveryEmail(initialState, enrolmentData("attacker@example.com")))
      .rejects.toThrow("NEXT_REDIRECT:/account/security")

    expect(mocks.getRecoveryEmail).toHaveBeenCalledWith("player-one")
    expect(mocks.requestRecoveryEmailVerification).not.toHaveBeenCalled()
  })

  it("will not let the confirm half land a new address over a verified one", async () => {
    mocks.getRecoveryEmail.mockReturnValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      email: "parent@example.com",
      verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    })

    await expect(confirmCurrentRecoveryEmail(
      initialState,
      enrolmentData("attacker@example.com", "123456"),
    )).rejects.toThrow("NEXT_REDIRECT:/account/security")

    expect(mocks.confirmRecoveryEmailVerification).not.toHaveBeenCalled()
  })

  it("holds for the head coach, whose change flow demands a second factor", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({ role: "coach", subjectId: "head-one" })
    mocks.getRecoveryEmail.mockReturnValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      email: "coach@example.com",
      verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    })

    await expect(requestCurrentRecoveryEmail(initialState, enrolmentData("attacker@example.com")))
      .rejects.toThrow("NEXT_REDIRECT:/account/security")
    await expect(confirmCurrentRecoveryEmail(
      initialState,
      enrolmentData("attacker@example.com", "123456"),
    )).rejects.toThrow("NEXT_REDIRECT:/account/security")

    expect(mocks.requestRecoveryEmailVerification).not.toHaveBeenCalled()
    expect(mocks.confirmRecoveryEmailVerification).not.toHaveBeenCalled()
  })

  it("still completes a genuine first-time enrolment end to end", async () => {
    await expect(requestCurrentRecoveryEmail(initialState, enrolmentData("new@example.com")))
      .resolves.toEqual({ email: "new@example.com", error: null, sent: true })
    expect(mocks.requestRecoveryEmailVerification).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "player-one",
      email: "new@example.com",
    }))

    await expect(confirmCurrentRecoveryEmail(
      initialState,
      enrolmentData("new@example.com", "123456"),
    )).rejects.toThrow("NEXT_REDIRECT:/player")
    expect(mocks.confirmRecoveryEmailVerification).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "player-one",
      code: "123456",
      email: "new@example.com",
    }))
  })

  it("refuses an admin preview session before it reads the address", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({
      previewMode: true,
      role: "player",
      subjectId: "player-one",
    })

    await expect(requestCurrentRecoveryEmail(initialState, enrolmentData("attacker@example.com")))
      .rejects.toThrow("NEXT_REDIRECT:/admin")

    expect(mocks.getRecoveryEmail).not.toHaveBeenCalled()
    expect(mocks.requestRecoveryEmailVerification).not.toHaveBeenCalled()
  })
})
