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
  confirmRegistration: vi.fn(),
  registerPublicAccountRequest: vi.fn(),
  requestRegistration: vi.fn(),
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
  confirmRegistration: mocks.confirmRegistration,
  findApprovedAccountByAcademyId: mocks.findApprovedAccountByAcademyId,
  registerPublicAccountRequest: mocks.registerPublicAccountRequest,
  requestRegistration: mocks.requestRegistration,
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
  ACTIVATION_CLAIM_LIFETIME_MS: 30 * 24 * 60 * 60 * 1000,
  completeAccountActivation: mocks.completeAccountActivation,
  createActivationClaimToken: vi.fn(() => "test-activation-token-value-with-more-than-forty-characters"),
  loginIsBlocked: mocks.loginIsBlocked,
  // The shared-bucket tax. Zero here: these cases are about which answer comes
  // back, not how long it takes, and a real delay would only slow the suite.
  unknownBucketDelayMs: () => 0,
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
  confirmRegistrationCode,
  loginWithAcademyId,
  loginWithPin,
  requestRegistrationCode,
  type RegistrationFormState,
} from "@/app/login/actions"
import { OperationalActionError } from "@/lib/actions/operational-result"
import { EMPTY_REGISTRATION_VALUES } from "@/lib/auth/registration-form"

const initialState: RegistrationFormState = {
  academyId: null,
  error: null,
  errorField: null,
  standing: null,
  step: "details",
  values: EMPTY_REGISTRATION_VALUES,
}

const VALID_DETAILS = {
  dateOfBirth: "2014-03-11",
  email: "rakesh@example.com",
  fullName: "Mira Rao",
  phone: "+91 98765 43210",
  requestedRole: "player",
}

function registrationData(overrides: Record<string, string> = {}) {
  const formData = new FormData()
  for (const [field, value] of Object.entries({ ...VALID_DETAILS, ...overrides })) {
    formData.set(field, value)
  }
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
    mocks.requestRegistration.mockResolvedValue({ accepted: true })
    mocks.confirmRegistration.mockReturnValue({
      academyId: null,
      accountId: "account-1",
      standing: "new",
    })
  })

  it("sends a code without creating anything, and advances to the code step", async () => {
    const result = await requestRegistrationCode(initialState, registrationData())

    expect(result.step).toBe("code")
    expect(result.error).toBeNull()
    expect(mocks.requestRegistration).toHaveBeenCalledOnce()
    // No account is written at this point, so no claim cookie may be set either --
    // a cookie here would imply a registration that does not exist yet.
    expect(mocks.cookieSet).not.toHaveBeenCalled()
  })

  it("normalizes the name before the service ever sees it", async () => {
    await requestRegistrationCode(initialState, registrationData({ fullName: "  Mira   Rao  " }))

    expect(mocks.requestRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "Mira Rao" }),
    )
  })

  it("forwards an assistant-coach request under the existing coach role", async () => {
    await requestRegistrationCode(initialState, registrationData({ requestedRole: "coach" }))

    expect(mocks.requestRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ requestedRole: "coach" }),
    )
  })

  it("refuses a role nobody may request rather than forwarding it", async () => {
    await requestRegistrationCode(initialState, registrationData({ requestedRole: "platform_admin" }))

    // Anything that is not exactly "coach" collapses to "player", so a posted
    // platform_admin cannot ride in through the form.
    expect(mocks.requestRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ requestedRole: "player" }),
    )
  })

  it("keeps every entered value when the service refuses the details", async () => {
    mocks.requestRegistration.mockRejectedValueOnce(
      new OperationalActionError("INVALID_INPUT", "Enter a valid date of birth.", "dateOfBirth"),
    )

    const result = await requestRegistrationCode(initialState, registrationData())

    expect(result).toMatchObject({
      error: "Enter a valid date of birth.",
      errorField: "dateOfBirth",
      step: "details",
    })
    expect(result.values.fullName).toBe("Mira Rao")
    expect(result.values.email).toBe("rakesh@example.com")
  })

  it("shows a throttle trip as a recoverable error and does not advance", async () => {
    mocks.requestRegistration.mockRejectedValueOnce(
      new OperationalActionError(
        "BUSINESS_RULE",
        "Wait a few minutes before requesting another code.",
        "email",
      ),
    )

    const result = await requestRegistrationCode(initialState, registrationData())

    expect(result.step).toBe("details")
    expect(result.error).toContain("Wait a few minutes")
  })

  it("does not hide unexpected persistence failures", async () => {
    mocks.requestRegistration.mockRejectedValueOnce(new Error("database unavailable"))

    await expect(requestRegistrationCode(initialState, registrationData()))
      .rejects.toThrow("database unavailable")
  })

  it("creates the account and sets the claim cookie once the code is right", async () => {
    const result = await confirmRegistrationCode(
      { ...initialState, step: "code" },
      registrationData({ code: "123456" }),
    )

    expect(result).toMatchObject({ academyId: null, standing: "new", step: "done" })
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "smba_activation_claim",
      expect.any(String),
      expect.any(Object),
    )
  })

  it("surfaces an existing request without creating a second one", async () => {
    mocks.confirmRegistration.mockReturnValueOnce({
      academyId: null,
      accountId: null,
      standing: "pending",
    })

    const result = await confirmRegistrationCode(
      { ...initialState, step: "code" },
      registrationData({ code: "123456" }),
    )

    expect(result).toMatchObject({ standing: "pending", step: "done" })
    // Nothing was created, so nothing may be claimed.
    expect(mocks.cookieSet).not.toHaveBeenCalled()
  })

  it("returns the Academy ID only once the request is approved", async () => {
    mocks.confirmRegistration.mockReturnValueOnce({
      academyId: "SMBA-PL-0019",
      accountId: null,
      standing: "approved",
    })

    const result = await confirmRegistrationCode(
      { ...initialState, step: "code" },
      registrationData({ code: "123456" }),
    )

    expect(result).toMatchObject({ academyId: "SMBA-PL-0019", standing: "approved" })
  })

  it("answers every unusable code with one message, and stays on the code step", async () => {
    // Wrong, expired, already spent, attempts exhausted and throttled all arrive
    // here as null. Distinguishing them would reveal whether a challenge exists
    // for this identity -- the same disclosure the send step refuses to make.
    mocks.confirmRegistration.mockReturnValue(null)

    const result = await confirmRegistrationCode(
      { ...initialState, step: "code" },
      registrationData({ code: "000000" }),
    )

    expect(result).toMatchObject({
      error: "That code is invalid or expired.",
      errorField: "code",
      step: "code",
    })
    expect(mocks.cookieSet).not.toHaveBeenCalled()
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
      error: "Academy ID or password is incorrect. If this is your first visit, activate your account.",
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
      error: "Academy ID or password is incorrect. If this is your first visit, activate your account.",
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
      error: "Academy ID or PIN is incorrect. Use your password if PIN login is unavailable.",
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
