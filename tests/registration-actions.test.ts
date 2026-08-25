import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  clearDatabaseSession: vi.fn(),
  coachTotpRequired: vi.fn(() => false),
  completeAccountActivation: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  findApprovedAccountByAcademyId: vi.fn(),
  hashPassword: vi.fn(async () => "hashed"),
  loginIsBlocked: vi.fn(() => false),
  postAuthenticationDestination: vi.fn((input: {
    accountId: string
    role: "coach" | "platform_admin" | "player"
    twoFactorEnabled: boolean
  }) => {
    if (input.accountId === "head-account" && !input.twoFactorEnabled) {
      return "/auth/two-factor/setup"
    }
    if (input.role === "platform_admin") return "/admin"
    return input.role === "coach" ? "/coach" : "/player"
  }),
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
  redirect: vi.fn(),
  registerPublicAccountRequest: vi.fn(),
  signInPin: vi.fn(),
  signInUsername: vi.fn(),
  writeAuthSecurityEvent: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    delete: mocks.cookieDelete,
    get: mocks.cookieGet,
    set: mocks.cookieSet,
  })),
  headers: vi.fn(async () => new Headers()),
}))

// Stubbed so the cases below can watch the one deliberately expensive call in
// the action: a blocked attempt must never reach scrypt.
vi.mock("better-auth/crypto", () => ({ hashPassword: mocks.hashPassword }))

vi.mock("@/lib/auth/account-service", () => ({
  findApprovedAccountByAcademyId: mocks.findApprovedAccountByAcademyId,
  registerPublicAccountRequest: mocks.registerPublicAccountRequest,
}))

vi.mock("@/lib/auth/session", () => ({
  clearDatabaseSession: mocks.clearDatabaseSession,
}))

vi.mock("@/lib/auth/better-auth", () => ({
  auth: { api: { signInPin: mocks.signInPin, signInUsername: mocks.signInUsername } },
  coachTotpRequired: mocks.coachTotpRequired,
  getAuth: () => ({
    api: { signInPin: mocks.signInPin, signInUsername: mocks.signInUsername },
  }),
  principalTotpRequired: (role: string, accessLevel: string | null) => (
    role === "platform_admin"
    || (role === "coach" && accessLevel === "head_admin" && mocks.coachTotpRequired())
  ),
}))

vi.mock("@/lib/auth/credential-service", () => ({
  ACTIVATION_CLAIM_COOKIE: "smba_activation_claim",
  completeAccountActivation: mocks.completeAccountActivation,
  createActivationClaimToken: vi.fn(() => "test-activation-token-value-with-more-than-forty-characters"),
  loginIsBlocked: mocks.loginIsBlocked,
  recordLoginFailure: mocks.recordLoginFailure,
  recordLoginSuccess: mocks.recordLoginSuccess,
  validateNewPassword: vi.fn(() => null),
}))

vi.mock("@/lib/auth/security-context", () => ({
  authSubjectHash: vi.fn(() => "subject"),
  requestSecurityContext: vi.fn(() => ({ ipHash: "ip", userAgent: "test" })),
  writeAuthSecurityEvent: mocks.writeAuthSecurityEvent,
}))

vi.mock("@/lib/auth/post-auth-destination", () => ({
  postAuthenticationDestination: mocks.postAuthenticationDestination,
}))

import {
  activateAccount,
  loginWithAcademyId,
  loginWithPin,
  submitRegistration,
  type RegistrationFormState,
} from "@/app/login/actions"
import { OperationalActionError } from "@/lib/actions/operational-result"

const REQUEST_KEY = "11111111-1111-4111-8111-111111111111"
const initialState: RegistrationFormState = {
  error: null,
  errorField: null,
  requestedRole: "player",
  submitted: false,
}

function registrationData(
  fullName: string,
  requestedRole?: string,
  registrationRequestKey = REQUEST_KEY,
) {
  const formData = new FormData()
  formData.set("fullName", fullName)
  formData.set("registrationRequestKey", registrationRequestKey)
  if (requestedRole) formData.set("requestedRole", requestedRole)
  return formData
}

function activationData(password: string) {
  const formData = new FormData()
  formData.set("password", password)
  formData.set("confirmPassword", password)
  return formData
}

function loginData(secretName: "password" | "pin", secret: string) {
  const formData = new FormData()
  formData.set("academyId", "SMBA#0042")
  formData.set(secretName, secret)
  return formData
}

describe("public registration action", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("registers a valid public request as a player", async () => {
    const result = await submitRegistration(
      initialState,
      registrationData("  Mira   Rao  "),
    )

    expect(result).toEqual({ error: null, errorField: null, requestedRole: "player", submitted: true })
    expect(mocks.registerPublicAccountRequest).toHaveBeenCalledOnce()
    expect(mocks.registerPublicAccountRequest).toHaveBeenCalledWith({
      activationToken: "test-activation-token-value-with-more-than-forty-characters",
      fullName: "Mira Rao",
      requestKey: REQUEST_KEY,
      requestedRole: "player",
    })
    expect(mocks.cookieSet).toHaveBeenCalledWith("smba_activation_claim", expect.any(String), expect.any(Object))
  })

  it("registers a junior-coach request for head-coach approval", async () => {
    const result = await submitRegistration(
      initialState,
      registrationData("Riya Coach", "coach"),
    )

    expect(result).toEqual({ error: null, errorField: null, requestedRole: "coach", submitted: true })
    expect(mocks.registerPublicAccountRequest).toHaveBeenCalledWith({
      activationToken: "test-activation-token-value-with-more-than-forty-characters",
      fullName: "Riya Coach",
      requestKey: REQUEST_KEY,
      requestedRole: "coach",
    })
  })

  it("does not persist invalid registration requests", async () => {
    await expect(
      submitRegistration(initialState, registrationData("A")),
    ).resolves.toEqual({
      error: "Enter your full name.",
      errorField: "fullName",
      requestedRole: "player",
      submitted: false,
    })
    expect(mocks.registerPublicAccountRequest).not.toHaveBeenCalled()

  })

  it("returns request-key conflicts as recoverable form errors", async () => {
    mocks.registerPublicAccountRequest.mockImplementationOnce(() => {
      throw new OperationalActionError(
        "CONFLICT",
        "This registration request has changed. Refresh the page before trying again.",
        "registrationRequestKey",
      )
    })

    await expect(
      submitRegistration(initialState, registrationData("Mira Rao")),
    ).resolves.toEqual({
      error: "This registration request has changed. Refresh the page before trying again.",
      errorField: null,
      requestedRole: "player",
      submitted: false,
    })
  })

  it("does not hide unexpected persistence failures", async () => {
    mocks.registerPublicAccountRequest.mockImplementationOnce(() => {
      throw new Error("database unavailable")
    })

    await expect(
      submitRegistration(initialState, registrationData("Mira Rao")),
    ).rejects.toThrow("database unavailable")
  })
})

describe("role-aware login actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loginIsBlocked.mockReturnValue(false)
    mocks.coachTotpRequired.mockReturnValue(false)
  })

  it.each([
    [{ accessLevel: null, role: "player" as const }, "/player"],
    [{ accessLevel: "junior_coach" as const, role: "coach" as const }, "/coach"],
  ])("routes an active $role account to its workspace", async (identity, destination) => {
    mocks.findApprovedAccountByAcademyId.mockReturnValue({
      ...identity,
      accountId: "account-42",
      credentialStatus: "active",
    })
    mocks.signInUsername.mockResolvedValue({ user: { twoFactorEnabled: false } })

    await loginWithAcademyId({ error: null }, loginData("password", "A secure password"))

    expect(mocks.redirect).toHaveBeenCalledWith(destination)
  })

  it("routes a production head coach without an authenticator to mandatory setup", async () => {
    mocks.findApprovedAccountByAcademyId.mockReturnValue({
      accessLevel: "head_admin",
      accountId: "head-account",
      credentialStatus: "active",
      role: "coach",
    })
    mocks.coachTotpRequired.mockReturnValue(true)
    mocks.signInUsername.mockResolvedValue({ user: { twoFactorEnabled: false } })

    await loginWithAcademyId({ error: null }, loginData("password", "A secure password"))

    expect(mocks.redirect).toHaveBeenCalledWith("/auth/two-factor/setup")
  })

  // The same split now holds for the password door: POST /sign-in/username
  // reaches its endpoint without passing through this action, so the budget is
  // spent in the endpoint's hooks and what is left here is translation. The
  // guard itself is covered against the real endpoint in
  // tests/better-auth-runtime.test.ts.
  it("reports a spent password budget as a wait, not as a bad credential", async () => {
    mocks.findApprovedAccountByAcademyId.mockReturnValue({
      accessLevel: null,
      accountId: "player-account",
      credentialStatus: "active",
      role: "player",
    })
    mocks.signInUsername.mockRejectedValue(Object.assign(new Error("rate limited"), {
      status: "TOO_MANY_REQUESTS",
    }))

    await expect(
      loginWithAcademyId({ error: null }, loginData("password", "A secure password")),
    ).resolves.toEqual({
      error: "We couldn’t sign you in. Wait a few minutes before trying again.",
    })
  })

  it("reports any other password refusal generically and spends no budget of its own", async () => {
    mocks.findApprovedAccountByAcademyId.mockReturnValue({
      accessLevel: null,
      accountId: "player-account",
      credentialStatus: "active",
      role: "player",
    })
    mocks.signInUsername.mockRejectedValue(new Error("invalid password"))

    await expect(
      loginWithAcademyId({ error: null }, loginData("password", "A secure password")),
    ).resolves.toEqual({
      error: "SMBA username or password is incorrect. If this is your first visit, activate your account.",
    })
    expect(mocks.signInUsername).toHaveBeenCalledOnce()
    // The block is read here, but a failure is only ever counted by the hooks:
    // counting it here as well would halve the real budget and write every
    // audit row twice.
    expect(mocks.loginIsBlocked).toHaveBeenCalledOnce()
    expect(mocks.recordLoginFailure).not.toHaveBeenCalled()
  })

  it("still spends the budget for an Academy ID that never reaches the endpoint", async () => {
    mocks.findApprovedAccountByAcademyId.mockReturnValue(undefined)

    await expect(
      loginWithAcademyId({ error: null }, loginData("password", "A secure password")),
    ).resolves.toEqual({
      error: "SMBA username or password is incorrect. If this is your first visit, activate your account.",
    })
    // The hooks never see this attempt, so leaving it uncounted would make the
    // form a cheaper way to probe which Academy IDs exist than the endpoint.
    expect(mocks.signInUsername).not.toHaveBeenCalled()
    expect(mocks.recordLoginFailure).toHaveBeenCalledOnce()
    expect(mocks.hashPassword).toHaveBeenCalledOnce()
  })

  // The two answers above are different strings, so they may only ever be
  // reachable together. Once the budget is spent the action stops answering
  // from the account row at all: without that, one request per candidate
  // Academy ID -- no password needed -- separates the real ones from the rest,
  // and the unknown-ID branch never blocks, so the probing never stops.
  it("answers a spent budget the same way whether the Academy ID exists or not", async () => {
    mocks.loginIsBlocked.mockReturnValue(true)
    // What the endpoint's hooks do to a real Academy ID when the budget is
    // spent; the guard itself is driven for real in tests/better-auth-runtime.test.ts.
    mocks.signInUsername.mockRejectedValue(Object.assign(new Error("rate limited"), {
      status: "TOO_MANY_REQUESTS",
    }))

    mocks.findApprovedAccountByAcademyId.mockReturnValue({
      accessLevel: null,
      accountId: "player-account",
      credentialStatus: "active",
      role: "player",
    })
    const existing = await loginWithAcademyId(
      { error: null },
      loginData("password", "A secure password"),
    )
    mocks.findApprovedAccountByAcademyId.mockReturnValue(undefined)
    const unknown = await loginWithAcademyId(
      { error: null },
      loginData("password", "A secure password"),
    )

    expect(existing).toEqual({
      error: "We couldn\u2019t sign you in. Wait a few minutes before trying again.",
    })
    expect(unknown).toEqual(existing)
    // Blocked has to mean blocked: no scrypt burned on an unauthenticated path,
    // no further budget spent, and the endpoint never dispatched, so the hooks
    // cannot audit the same attempt a second time.
    expect(mocks.hashPassword).not.toHaveBeenCalled()
    expect(mocks.recordLoginFailure).not.toHaveBeenCalled()
    expect(mocks.signInUsername).not.toHaveBeenCalled()
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledTimes(2)
    expect(mocks.writeAuthSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      eventType: "login_rate_limited",
      outcome: "blocked",
    }))
  })

  // The account/IP budget for PIN sign-in is spent inside the endpoint, because
  // POST /api/auth/sign-in/pin reaches it without passing through this action at
  // all. What is left here is translation, and that is what these assert: this
  // action must not spend the budget a second time, and it must tell someone who
  // is locked out to wait rather than that their PIN was wrong. The guard itself
  // is covered against the real endpoint in tests/better-auth-runtime.test.ts.
  it("reports a spent PIN budget as a wait, not as a bad credential", async () => {
    mocks.findApprovedAccountByAcademyId.mockReturnValue({
      accessLevel: null,
      accountId: "player-account",
      credentialStatus: "active",
      role: "player",
    })
    mocks.signInPin.mockRejectedValue(Object.assign(new Error("rate limited"), {
      status: "TOO_MANY_REQUESTS",
    }))

    await expect(loginWithPin({ error: null }, loginData("pin", "123456"))).resolves.toEqual({
      error: "We couldn\u2019t sign you in. Wait a few minutes before trying again.",
    })
  })

  it("reports any other PIN refusal generically and spends no budget of its own", async () => {
    mocks.findApprovedAccountByAcademyId.mockReturnValue({
      accessLevel: null,
      accountId: "player-account",
      credentialStatus: "active",
      role: "player",
    })
    mocks.signInPin.mockRejectedValue(new Error("invalid pin"))

    await expect(loginWithPin({ error: null }, loginData("pin", "123456"))).resolves.toEqual({
      error: "SMBA username or PIN is incorrect. Use your password if PIN login is unavailable.",
    })
    expect(mocks.signInPin).toHaveBeenCalledOnce()
    // Counting here as well as in the endpoint would halve the real budget and
    // write every audit row twice.
    expect(mocks.recordLoginFailure).not.toHaveBeenCalled()
    expect(mocks.loginIsBlocked).not.toHaveBeenCalled()
  })
})

describe("account activation action", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loginIsBlocked.mockReturnValue(false)
    mocks.cookieGet.mockReturnValue({ value: "an-activation-claim-token" })
    mocks.completeAccountActivation.mockResolvedValue({
      academyId: "SMBA#0042",
      accountId: "player-account",
    })
  })

  it("sends a newly activated player on to PIN setup", async () => {
    mocks.signInUsername.mockResolvedValue({ user: { twoFactorEnabled: false } })

    await activateAccount({ error: null, errorField: null }, activationData("A secure password"))

    expect(mocks.cookieDelete).toHaveBeenCalledWith("smba_activation_claim")
    expect(mocks.redirect).toHaveBeenCalledWith("/auth/pin/setup")
  })

  // By this point the password is written and the claim is consumed, so the
  // account is live no matter what the sign-in answers. A refusal has to be
  // reported as a missing session -- somebody whose account already works must
  // not be shown a crashed form and left with a claim they cannot reuse.
  it("keeps a completed activation usable when the session is refused", async () => {
    mocks.signInUsername.mockRejectedValue(Object.assign(new Error("rate limited"), {
      status: "TOO_MANY_REQUESTS",
    }))

    await expect(
      activateAccount({ error: null, errorField: null }, activationData("A secure password")),
    ).resolves.toEqual({
      error: "Your account is ready, but we couldn\u2019t sign you in."
        + " Open the sign-in page and use your new password.",
      errorField: null,
    })
    expect(mocks.cookieDelete).toHaveBeenCalledWith("smba_activation_claim")
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
