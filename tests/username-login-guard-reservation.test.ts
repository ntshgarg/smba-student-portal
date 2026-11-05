/**
 * Password sign-in spends its guess before the slow password check.
 *
 * The `before` hook used to read the block and the `after` hook to count the
 * failure, with an ~80 ms scrypt between them, so a burst of simultaneous
 * guesses all read "not blocked" first. PIN sign-in was fixed this way on
 * 5 Nov; this is the same fix for the password door.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findApprovedAccountByAcademyId: vi.fn(() => ({ accountId: "player-7" })),
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
  releaseLoginAttempt: vi.fn(),
  reserveLoginAttempt: vi.fn(() => true),
  writeAuthSecurityEvent: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("better-auth/api", () => ({
  createAuthMiddleware: (handler: unknown) => handler,
  isAPIError: (value: unknown) => value instanceof Error && "status" in value,
}))
vi.mock("@/lib/auth/account-service", () => ({
  findApprovedAccountByAcademyId: mocks.findApprovedAccountByAcademyId,
}))
vi.mock("@/lib/auth/credential-service", () => ({
  recordLoginFailure: mocks.recordLoginFailure,
  recordLoginSuccess: mocks.recordLoginSuccess,
  releaseLoginAttempt: mocks.releaseLoginAttempt,
  reserveLoginAttempt: mocks.reserveLoginAttempt,
}))
vi.mock("@/lib/auth/security-context", () => ({
  authSubjectHash: vi.fn(() => "subject-hash"),
  requestSecurityContext: vi.fn(() => ({ ipHash: "ip-hash", userAgent: "test-browser" })),
  writeAuthSecurityEvent: mocks.writeAuthSecurityEvent,
}))

import { signInWithJustWrittenPassword, usernameLoginHooks } from "@/lib/auth/username-login-guard"

type Hook = (context: unknown) => Promise<void>
const before = usernameLoginHooks.before as unknown as Hook
const after = usernameLoginHooks.after as unknown as Hook

function hookContext(returned?: unknown) {
  return {
    body: { password: "a guess", username: "SMBA-PL-0007" },
    context: { returned },
    error: (status: string, body: { message: string }) =>
      Object.assign(new Error(body.message), { status }),
    headers: new Headers(),
    path: "/sign-in/username",
  }
}

const refused = Object.assign(new Error("INVALID_USERNAME_OR_PASSWORD"), { status: "UNAUTHORIZED" })
const attempt = { ipHash: "ip-hash", subjectHash: "subject-hash" }

describe("password sign-in reserves each guess before the password is checked", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reserveLoginAttempt.mockReturnValue(true)
  })

  it("spends the guess in `before`, as one check-and-count step", async () => {
    await expect(before(hookContext())).resolves.toBeUndefined()
    expect(mocks.reserveLoginAttempt).toHaveBeenCalledWith(attempt)
  })

  it("refuses in `before` when the reservation is refused", async () => {
    mocks.reserveLoginAttempt.mockReturnValue(false)
    await expect(before(hookContext())).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" })
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "login_rate_limited",
      outcome: "blocked",
    }))
  })

  it("does not count a wrong password a second time in `after`", async () => {
    await after(hookContext(refused))
    expect(mocks.recordLoginFailure).not.toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "login_failed",
      outcome: "failure",
    }))
  })

  it("hands the guess back when the password was right", async () => {
    await after(hookContext({ token: "session", user: { id: "player-7" } }))
    expect(mocks.releaseLoginAttempt).toHaveBeenCalledWith(attempt)
    expect(mocks.recordLoginSuccess).not.toHaveBeenCalled()
  })

  it("leaves a password this server just wrote out of the reservation, and counts it as before", async () => {
    await signInWithJustWrittenPassword(async () => {
      await before(hookContext())
      await after(hookContext(refused))
    })
    expect(mocks.reserveLoginAttempt).not.toHaveBeenCalled()
    expect(mocks.recordLoginFailure).toHaveBeenCalledWith(attempt)

    vi.clearAllMocks()
    await signInWithJustWrittenPassword(async () => {
      await after(hookContext({ token: "session", user: { id: "player-7" } }))
    })
    expect(mocks.recordLoginSuccess).toHaveBeenCalledWith("subject-hash")
    expect(mocks.releaseLoginAttempt).not.toHaveBeenCalled()
  })

  it("ignores requests that are not password sign-in", async () => {
    await before({ ...hookContext(), path: "/sign-in/pin" })
    expect(mocks.reserveLoginAttempt).not.toHaveBeenCalled()
  })
})
