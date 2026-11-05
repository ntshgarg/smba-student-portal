/**
 * A PIN chosen before 5 Nov 2026 never met the strength rules, and sign-in
 * checks only that a PIN is six digits so that old PINs keep working. That left
 * 123456 and birthday PINs signing children in. A right-but-weak PIN is now
 * switched off at the door instead of opening a session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  findApprovedAccountByAcademyId: vi.fn(),
  findUserById: vi.fn(),
  releaseLoginAttempt: vi.fn(),
  removePinCredential: vi.fn(),
  reserveLoginAttempt: vi.fn(() => true),
  setSessionCookie: vi.fn(),
  verifyPinLogin: vi.fn(),
  writeAuthSecurityEvent: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("better-auth/api", () => ({
  createAuthEndpoint: (_path: string, _options: unknown, handler: unknown) => handler,
}))
vi.mock("better-auth/cookies", () => ({ setSessionCookie: mocks.setSessionCookie }))
vi.mock("@/lib/auth/account-service", () => ({
  findApprovedAccountByAcademyId: mocks.findApprovedAccountByAcademyId,
}))
vi.mock("@/lib/auth/credential-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/credential-service")>(
    "@/lib/auth/credential-service",
  )
  return {
    releaseLoginAttempt: mocks.releaseLoginAttempt,
    removePinCredential: mocks.removePinCredential,
    reserveLoginAttempt: mocks.reserveLoginAttempt,
    validateNewPin: actual.validateNewPin,
    verifyPinLogin: mocks.verifyPinLogin,
  }
})
vi.mock("@/lib/auth/security-context", () => ({
  authSubjectHash: vi.fn(() => "subject-hash"),
  requestSecurityContext: vi.fn(() => ({ ipHash: "ip-hash", userAgent: "test-browser" })),
  writeAuthSecurityEvent: mocks.writeAuthSecurityEvent,
}))

import { RETIRED_PIN_LOGIN, smbaPinLogin } from "@/lib/auth/pin-plugin"

type Handler = (context: unknown) => Promise<unknown>
const signInPin = smbaPinLogin().endpoints.signInPin as unknown as Handler

function endpointContext(pin: string) {
  return {
    body: { pin, username: "SMBA-PL-0007" },
    context: {
      internalAdapter: {
        createSession: mocks.createSession,
        findUserById: mocks.findUserById,
      },
    },
    error: (status: string, body: { message: string }) =>
      Object.assign(new Error(body.message), { status }),
    headers: new Headers(),
    json: (value: unknown) => value,
  }
}

describe("a weak PIN from before the strength rules", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reserveLoginAttempt.mockReturnValue(true)
    mocks.findApprovedAccountByAcademyId.mockReturnValue({ accountId: "player-7" })
    mocks.findUserById.mockResolvedValue({ id: "player-7" })
    mocks.createSession.mockResolvedValue({ token: "session-token" })
    mocks.verifyPinLogin.mockResolvedValue({
      accountId: "player-7",
      role: "player",
      twoFactorEnabled: false,
    })
  })

  it.each(["123456", "000000", "150812", "121212"])(
    "is switched off rather than signing in, when %s is right",
    async (pin) => {
      await expect(signInPin(endpointContext(pin))).rejects.toMatchObject({
        message: RETIRED_PIN_LOGIN,
        status: "FORBIDDEN",
      })
      expect(mocks.removePinCredential).toHaveBeenCalledWith("player-7", { reason: "weak_legacy_pin" })
      expect(mocks.createSession).not.toHaveBeenCalled()
      expect(mocks.setSessionCookie).not.toHaveBeenCalled()
      // Nobody signed in, so the reservation stands: handing it back would also
      // clear the account's other failure counters.
      expect(mocks.releaseLoginAttempt).not.toHaveBeenCalled()
      expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
        accountId: "player-7",
        eventType: "login_failed",
        metadata: { factor: "pin", reason: "weak_legacy_pin" },
        outcome: "blocked",
      }))
    },
  )

  it("signs a strong PIN in as before", async () => {
    await expect(signInPin(endpointContext("739251"))).resolves.toMatchObject({
      token: "session-token",
    })
    expect(mocks.removePinCredential).not.toHaveBeenCalled()
    expect(mocks.setSessionCookie).toHaveBeenCalled()
    // Only a verified PIN resets the PIN budget, so the PIN door says so.
    expect(mocks.releaseLoginAttempt).toHaveBeenCalledWith({
      factor: "pin",
      ipHash: "ip-hash",
      subjectHash: "subject-hash",
    })
  })

  it("never switches off a PIN on a wrong guess, however weak the guess", async () => {
    mocks.verifyPinLogin.mockResolvedValue(null)
    await expect(signInPin(endpointContext("123456"))).rejects.toMatchObject({
      status: "UNAUTHORIZED",
    })
    expect(mocks.removePinCredential).not.toHaveBeenCalled()
  })
})
