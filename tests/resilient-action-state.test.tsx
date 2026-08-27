import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * ST-1. `useActionState` has no failure channel: a rejected action is re-thrown
 * during render and escalates to the nearest error boundary, taking the form and
 * everything typed into it with the unmounted subtree. A dropped request is
 * enough. These forms are every way into the product.
 *
 * The suite has no DOM, so React's own dispatch cannot be driven here. What can
 * be driven -- and what the defect turns on -- is the action each form hands to
 * `useActionState`. `useActionState` is stubbed so that action can be pulled out
 * and rejected directly. A wrapped action *resolves*, which is precisely what
 * stops React escalating; an unwrapped one rejects, which is precisely what
 * destroys the page.
 */

type CapturedState = { error: string | null }
type CapturedAction = (state: CapturedState, payload: FormData) => Promise<CapturedState>

const { actionSites, controls, droppedRequest, reportClientError } = vi.hoisted(() => ({
  actionSites: [] as Array<{ action: CapturedAction; initialState: CapturedState }>,
  controls: {
    loginMethod: "password" as "password" | "pin",
    renderedStates: null as CapturedState[] | null,
  },
  droppedRequest: () => Promise.reject(new TypeError("Failed to fetch")),
  reportClientError: vi.fn(),
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useActionState: (action: CapturedAction, initialState: CapturedState) => {
      const index = actionSites.length
      actionSites.push({ action, initialState })
      return [controls.renderedStates?.[index] ?? initialState, () => {}, false]
    },
    // The login method switch is component state and a static render cannot
    // press it. "password" is the only initial value of its kind in these
    // components, so steering it reaches the PIN form's own call site.
    useState: (initial: unknown) =>
      actual.useState(initial === "password" ? controls.loginMethod : initial),
  }
})

vi.mock("@/lib/telemetry/report-client-error", () => ({ reportClientError }))

vi.mock("@/app/login/actions", () => ({
  activateAccount: droppedRequest,
  loginWithAcademyId: droppedRequest,
  loginWithPin: droppedRequest,
}))
vi.mock("@/app/auth/pin/actions", () => ({
  setupPinAction: droppedRequest,
  skipPinSetupAction: droppedRequest,
}))
vi.mock("@/app/recover/actions", () => ({
  completePasswordRecoveryAction: droppedRequest,
  requestPasswordRecoveryAction: droppedRequest,
  verifyRecoverySecondFactorAction: droppedRequest,
}))
vi.mock("@/app/setup/head-coach/actions", () => ({
  completeHeadCoachSetupAction: droppedRequest,
}))
vi.mock("@/app/auth/two-factor/actions", () => ({
  beginAuthenticatorReconnect: droppedRequest,
  confirmTotpSetup: droppedRequest,
  startTotpSetup: droppedRequest,
  verifyBackupCodeSignIn: droppedRequest,
  verifyTotpSignIn: droppedRequest,
}))
vi.mock("@/app/auth/two-factor/recovery/actions", () => ({
  requestAuthenticatorRecoveryAction: droppedRequest,
  submitAuthenticatorRecoveryApprovalAction: droppedRequest,
}))
vi.mock("@/app/account/recovery-email/actions", () => ({
  confirmRecoveryEmailChange: droppedRequest,
  requestRecoveryEmailChange: droppedRequest,
}))
vi.mock("@/app/account/security/actions", () => ({
  changePasswordAction: droppedRequest,
  reissueRecoveryCodesAction: droppedRequest,
  removePinAction: droppedRequest,
  revokeOtherSessionsAction: droppedRequest,
  revokeSessionAction: droppedRequest,
  savePinAction: droppedRequest,
}))

const { resilientAction } = await import("@/lib/client/use-resilient-action-state")
const { AccountSecurityWorkspace } = await import("@/components/account-security-workspace")
const { ActivationForm } = await import("@/components/activation-form")
const { AuthenticatorRecoveryApprovalForm, AuthenticatorRecoveryRequestForm } = await import(
  "@/components/authenticator-recovery-form"
)
const { HeadCoachSetupForm } = await import("@/components/head-coach-setup-form")
const { LoginForm } = await import("@/components/login-form")
const { PinSetupForm } = await import("@/components/pin-setup-form")
const { RecoveryEmailEnrollmentForm } = await import("@/components/recovery-email-enrollment-form")
const { RecoveryEmailSecurityPanel } = await import("@/components/recovery-email-security-panel")
const { RecoveryForm } = await import("@/components/recovery-form")
const { RecoveryPasswordForm, RecoverySecondFactorForm } = await import(
  "@/components/recovery-reset-forms"
)
const { TwoFactorReconnectForm } = await import("@/components/two-factor-reconnect-form")
const { TwoFactorSetupForm } = await import("@/components/two-factor-setup-form")
const { TwoFactorVerificationForm } = await import("@/components/two-factor-verification-form")

/** The sentence `describeSaveFailure` writes for a request that never arrived. */
function unreachable(subject: string, retained: string) {
  return `${subject} could not be saved because the request did not complete.`
    + ` ${retained}. Check the connection and try again.`
}

type Surface = {
  /** Markup that proves the form itself, and what was in it, is still rendered. */
  intact: string[]
  name: string
  render: () => ReactElement
  /** One entry per `useActionState` call the render reaches, in call order. */
  sites: Array<{ retained: string; subject: string }>
  /** Sites whose message the default branch actually displays. */
  visible?: number[]
}

const signIn = {
  retained: "Nothing was sent and you are still signed out",
  subject: "Your sign-in",
}

const surfaces: Surface[] = [
  {
    intact: ['name="academyId"', 'name="password"'],
    name: "/login password form",
    render: () => {
      controls.loginMethod = "password"
      return <LoginForm />
    },
    sites: [signIn],
  },
  {
    intact: ['name="academyId"', 'name="pin"'],
    name: "/login PIN form",
    render: () => {
      controls.loginMethod = "pin"
      return <LoginForm />
    },
    sites: [signIn],
  },
  {
    intact: ['value="SMBA-PL-0001"', 'name="confirmPassword"'],
    name: "/activate",
    render: () => <ActivationForm academyId="SMBA-PL-0001" />,
    sites: [{
      retained: "Nothing was changed and your account is not activated yet",
      subject: "Your new password",
    }],
  },
  {
    intact: ['name="pin"', 'name="confirmPin"'],
    name: "/auth/pin/setup",
    render: () => <PinSetupForm />,
    sites: [{
      retained: "Nothing was changed and your password still signs you in",
      subject: "Your PIN",
    }],
  },
  {
    intact: ['name="academyId"', 'name="email"'],
    name: "/recover",
    render: () => <RecoveryForm />,
    sites: [{ retained: "No reset email was sent", subject: "Your reset request" }],
  },
  {
    intact: ['name="credential"'],
    name: "/recover/reset second factor",
    render: () => <RecoverySecondFactorForm />,
    sites: [{
      retained: "The code was not used and your reset link still works",
      subject: "Your code",
    }],
  },
  {
    intact: ['name="password"', 'name="confirmPassword"'],
    name: "/recover/reset new password",
    render: () => <RecoveryPasswordForm />,
    sites: [{
      retained: "Your old password still works and the reset link is still valid",
      subject: "Your new password",
    }],
  },
  {
    intact: ['name="fullName"', 'value="Ishaan Rao"', 'name="confirmPin"'],
    name: "/setup/head-coach",
    render: () => <HeadCoachSetupForm defaultName="Ishaan Rao" recoveryEmail="coach@example.com" />,
    sites: [{
      retained: "No account was created and this one-time setup link still works",
      subject: "Your head-coach account",
    }],
  },
  {
    intact: ['name="password"'],
    name: "/auth/two-factor/setup",
    render: () => <TwoFactorSetupForm role="coach" />,
    sites: [
      { retained: "No authenticator was connected", subject: "Your authenticator setup" },
      {
        retained: "The recovery codes above are still on screen",
        subject: "Your six-digit code",
      },
    ],
    visible: [0],
  },
  {
    intact: ['name="code"', 'name="trustDevice"'],
    name: "/auth/two-factor",
    render: () => <TwoFactorVerificationForm />,
    sites: [
      {
        retained: "The code was not used and you are still signed out",
        subject: "Your six-digit code",
      },
      { retained: "The code was not used and is still valid", subject: "Your recovery code" },
    ],
    visible: [0],
  },
  {
    intact: ['name="password"', 'name="secondFactor"'],
    name: "/auth/two-factor/reconnect",
    render: () => <TwoFactorReconnectForm />,
    sites: [{
      retained: "Your current authenticator and recovery codes still work",
      subject: "Your authenticator reconnect",
    }],
  },
  {
    intact: ['name="academyId"', 'name="email"'],
    name: "/auth/two-factor/recovery request",
    render: () => <AuthenticatorRecoveryRequestForm />,
    sites: [{ retained: "No verification email was sent", subject: "Your recovery request" }],
  },
  {
    intact: ["SMBA-HC-0001"],
    name: "/auth/two-factor/recovery approval",
    render: () => <AuthenticatorRecoveryApprovalForm academyId="SMBA-HC-0001" />,
    sites: [{
      retained: "Nothing was submitted and no coach session was revoked",
      subject: "Your reset request",
    }],
  },
  {
    intact: ['name="email"', 'name="fullName"'],
    name: "/account/recovery-email/setup",
    render: () => (
      <RecoveryEmailEnrollmentForm
        collectName
        confirmAction={droppedRequest}
        defaultName="Ishaan Rao"
        requestAction={droppedRequest}
      />
    ),
    sites: [
      { retained: "No verification code was sent", subject: "Your recovery email" },
      { retained: "The code was not used and is still valid", subject: "Your verification code" },
    ],
    visible: [0],
  },
  {
    intact: ['name="email"', 'name="currentPassword"', 'name="secondFactor"'],
    name: "/account/security recovery email",
    render: () => <RecoveryEmailSecurityPanel maskedEmail="i••@example.com" requiresSecondFactor />,
    sites: [
      {
        retained: "Your current recovery address is unchanged",
        subject: "Your recovery email change",
      },
      {
        retained: "The code was not used and your current address is unchanged",
        subject: "Your verification code",
      },
    ],
    visible: [0],
  },
  {
    intact: [
      'name="newPassword"',
      'name="confirmPin"',
      'id="pin-remove-current-password"',
      'id="security-recovery-codes-password"',
      'id="security-recovery-codes-second-factor"',
    ],
    name: "/account/security credentials",
    render: () => (
      <AccountSecurityWorkspace
        allowPin
        authenticatorEnabled
        authenticatorRequired
        pinEnabled
        pinRequired={false}
        sessions={[{
          createdAt: "2026-08-20T09:00:00.000Z",
          current: true,
          expiresAt: "2026-09-20T09:00:00.000Z",
          id: "session-1",
          ipAddress: null,
          userAgent: "Macintosh",
        }]}
        unusedRecoveryCodeCount={9}
      />
    ),
    sites: [
      { retained: "Your current password still works", subject: "Your new password" },
      { retained: "Your current sign-in options are unchanged", subject: "Your PIN" },
      { retained: "Your PIN still works", subject: "Your PIN removal" },
      {
        retained: "No device was signed out and your authenticator app is unchanged",
        subject: "Your new recovery codes",
      },
    ],
  },
]

beforeAll(() => {
  // `classifyNetworkFailure` reads `navigator.onLine` only to choose between the
  // offline and unreachable wordings. Pin it so the copy is the same everywhere.
  vi.stubGlobal("navigator", { onLine: true })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  actionSites.length = 0
  controls.loginMethod = "password"
  controls.renderedStates = null
  reportClientError.mockClear()
})

describe("a dropped request leaves an authentication form standing", () => {
  it.each(surfaces)("$name", async (surface) => {
    const beforeSubmit = renderToStaticMarkup(surface.render())
    expect(actionSites).toHaveLength(surface.sites.length)

    const folded: CapturedState[] = []
    for (const [index, site] of actionSites.entries()) {
      // Rejecting here is the whole point: unwrapped, this line throws and React
      // takes the page down with it.
      const next = await site.action(site.initialState, new FormData())
      expect(next.error).toBe(unreachable(surface.sites[index].subject, surface.sites[index].retained))
      folded.push(next)
    }

    controls.renderedStates = folded
    actionSites.length = 0
    const afterFailure = renderToStaticMarkup(surface.render())

    for (const marker of surface.intact) {
      expect(beforeSubmit).toContain(marker)
      expect(afterFailure).toContain(marker)
    }
    for (const index of surface.visible ?? surface.sites.map((_site, at) => at)) {
      expect(afterFailure).toContain(folded[index].error)
      expect(afterFailure).toContain('role="alert"')
    }
    // A transport failure is an operating condition, not a fault to report.
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it("covers all 23 call sites across the thirteen authentication components", () => {
    expect(surfaces.reduce((total, surface) => total + surface.sites.length, 0)).toBe(23)
  })
})

describe("two-factor recovery codes survive a dropped verification", () => {
  it("keeps the once-only codes on screen beside the failure", async () => {
    renderToStaticMarkup(<TwoFactorSetupForm role="coach" />)
    const [, verify] = actionSites
    const folded = await verify.action(verify.initialState, new FormData())

    actionSites.length = 0
    controls.renderedStates = [
      {
        error: null,
        setup: {
          backupCodes: ["AAAA-1111", "BBBB-2222"],
          totpURI: "otpauth://totp/SMBA:coach?secret=JBSWY3DPEHPK3PXP&issuer=SMBA",
        },
      } as CapturedState,
      folded,
    ]
    const markup = renderToStaticMarkup(<TwoFactorSetupForm role="coach" />)

    expect(markup).toContain("AAAA-1111")
    expect(markup).toContain("BBBB-2222")
    expect(markup).toContain("The recovery codes above are still on screen")
  })
})

describe("the wrapper's contract", () => {
  type FieldState = { error: string | null; errorField: "password" | null }
  const copy = { retained: "Nothing was sent", subject: "Your sign-in" }

  it("passes a settled action straight through", async () => {
    const action = resilientAction<CapturedState>(async () => ({ error: "Wrong password" }), copy)

    await expect(action({ error: null }, new FormData())).resolves
      .toEqual({ error: "Wrong password" })
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it("names the device when it is the one that is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false })
    const action = resilientAction<CapturedState>(droppedRequest, copy)

    await expect(action({ error: null }, new FormData())).resolves.toEqual({
      error: "Your sign-in could not be saved because this device is offline."
        + " Nothing was sent. Try again when the connection returns.",
    })
    vi.stubGlobal("navigator", { onLine: true })
  })

  it("folds into the state on screen rather than replacing it", async () => {
    const action = resilientAction<FieldState>(droppedRequest, {
      ...copy,
      fold: (state, error) => ({ ...state, error, errorField: null }),
    })

    await expect(
      action({ error: "Enter a password", errorField: "password" }, new FormData()),
    ).resolves.toEqual({
      error: unreachable("Your sign-in", "Nothing was sent"),
      errorField: null,
    })
  })

  it("reports a rejection that is not a transport failure instead of swallowing it", async () => {
    const fault = new Error("Cannot read properties of undefined")
    const action = resilientAction<CapturedState>(() => Promise.reject(fault), copy)

    await expect(action({ error: null }, new FormData())).resolves
      .toEqual({ error: "Cannot read properties of undefined" })
    expect(reportClientError).toHaveBeenCalledWith({
      boundary: "window",
      error: fault,
      eventType: "unhandled_rejection",
    })
  })
})
