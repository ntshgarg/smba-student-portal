import { notFound, redirect } from "next/navigation"
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

/**
 * How every one of these forms opens its sentence for a reply that never came
 * back. A dropped connection cannot say whether the server got there first, so
 * none of them may call it a failure.
 */
function unreachable(subject: string) {
  return `${subject} was not confirmed because the connection dropped,`
    + " so it may or may not have gone through. "
}

/**
 * The promises these forms used to make after a dropped reply. Each is false
 * once the server has finished: the password, PIN, recovery codes, reset link
 * or authenticator it says is untouched may already have been replaced.
 */
const promisesNothingHappened = new RegExp([
  "still works",
  "still valid",
  "was not used",
  "was not sent",
  "nothing was (sent|changed|submitted)",
  "no account was created",
  "no authenticator was connected",
  "could not be saved",
].join("|"), "iu")

type Surface = {
  /** Markup that proves the form itself, and what was in it, is still rendered. */
  intact: string[]
  name: string
  render: () => ReactElement
  /** One entry per `useActionState` call the render reaches, in call order. */
  sites: Array<{ subject: string }>
  /** Sites whose message the default branch actually displays. */
  visible?: number[]
}

const signIn = {
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
      subject: "Your new password",
    }],
  },
  {
    intact: ['name="pin"', 'name="confirmPin"'],
    name: "/auth/pin/setup",
    render: () => <PinSetupForm />,
    sites: [{
      subject: "Your PIN",
    }],
  },
  {
    intact: ['name="academyId"', 'name="email"'],
    name: "/recover",
    render: () => <RecoveryForm />,
    sites: [{ subject: "Your reset request" }],
  },
  {
    intact: ['name="credential"'],
    name: "/recover/reset second factor",
    render: () => <RecoverySecondFactorForm />,
    sites: [{
      subject: "Your code",
    }],
  },
  {
    intact: ['name="password"', 'name="confirmPassword"'],
    name: "/recover/reset new password",
    render: () => <RecoveryPasswordForm />,
    sites: [{
      subject: "Your new password",
    }],
  },
  {
    intact: ['name="fullName"', 'value="Ishaan Rao"', 'name="confirmPin"'],
    name: "/setup/head-coach",
    render: () => <HeadCoachSetupForm defaultName="Ishaan Rao" recoveryEmail="coach@example.com" />,
    sites: [{
      subject: "Your head-coach account",
    }],
  },
  {
    intact: ['name="password"'],
    name: "/auth/two-factor/setup",
    render: () => <TwoFactorSetupForm role="coach" />,
    sites: [
      { subject: "Your authenticator setup" },
      {
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
        subject: "Your six-digit code",
      },
      { subject: "Your recovery code" },
    ],
    visible: [0],
  },
  {
    intact: ['name="password"', 'name="secondFactor"'],
    name: "/auth/two-factor/reconnect",
    render: () => <TwoFactorReconnectForm />,
    sites: [{
      subject: "Your authenticator reconnect",
    }],
  },
  {
    intact: ['name="academyId"', 'name="email"'],
    name: "/auth/two-factor/recovery request",
    render: () => <AuthenticatorRecoveryRequestForm />,
    sites: [{ subject: "Your recovery request" }],
  },
  {
    intact: ["SMBA-HC-0001"],
    name: "/auth/two-factor/recovery approval",
    render: () => <AuthenticatorRecoveryApprovalForm academyId="SMBA-HC-0001" />,
    sites: [{
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
      { subject: "Your recovery email" },
      { subject: "Your verification code" },
    ],
    visible: [0],
  },
  {
    intact: ['name="email"', 'name="currentPassword"', 'name="secondFactor"'],
    name: "/account/security recovery email",
    render: () => <RecoveryEmailSecurityPanel maskedEmail="i••@example.com" requiresSecondFactor />,
    sites: [
      {
        subject: "Your recovery email change",
      },
      {
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
      { subject: "Your new password" },
      { subject: "Your PIN" },
      { subject: "Your PIN removal" },
      {
        subject: "Your request for new recovery codes",
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
      expect(next.error?.startsWith(unreachable(surface.sites[index].subject))).toBe(true)
      // The reply may have been lost after the server finished, so nothing
      // that would then be false -- "your old password still works" -- is said.
      expect(next.error).not.toMatch(promisesNothingHappened)
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

/**
 * The four forms where the old sentence did real harm: each change is finished
 * on the server before its reply is sent, so after a lost reply the old
 * password, reset link, recovery codes or authenticator the form called safe
 * may already be dead. What each says now is what to try, in the order that
 * finds out.
 */
describe("after a lost reply the credential forms say what may already have changed", () => {
  async function droppedMessage(render: () => ReactElement, site: number) {
    renderToStaticMarkup(render())
    const { action, initialState } = actionSites[site]
    return (await action(initialState, new FormData())).error
  }

  it("tells someone resetting their password to try the new one", async () => {
    const message = await droppedMessage(() => <RecoveryPasswordForm />, 0)
    expect(message).toBe(unreachable("Your new password")
      + "If it went through, your old password and this link no longer work."
      + " Try signing in with your new password; if it is refused, reload this page and try again.")
  })

  it("tells someone at the code step to reload before spending another saved code", async () => {
    const message = await droppedMessage(() => <RecoverySecondFactorForm />, 0)
    expect(message).toContain("Reload this page before trying again")
    expect(message).toContain("A saved recovery code works only once")
  })

  it("does not promise the reset email went unsent", async () => {
    const message = await droppedMessage(() => <RecoveryForm />, 0)
    expect(message).toContain("Check your inbox before asking again")
  })

  it("tells a coach changing their password that the new one may be the one that works", async () => {
    const message = await droppedMessage(() => (
      <AccountSecurityWorkspace
        allowPin
        authenticatorEnabled
        authenticatorRequired
        pinEnabled
        pinRequired={false}
        sessions={[]}
        unusedRecoveryCodeCount={9}
      />
    ), 0)
    expect(message).toContain("your new password is now the one that works")
    expect(message).toContain("if you are asked to sign in, use your new password")
  })

  it("tells a head coach whose reissue reply was lost that the old codes may be dead", async () => {
    const message = await droppedMessage(() => (
      <AccountSecurityWorkspace
        allowPin
        authenticatorEnabled
        authenticatorRequired
        pinEnabled
        pinRequired={false}
        sessions={[]}
        unusedRecoveryCodeCount={9}
      />
    ), 3)
    expect(message).toContain("your old codes no longer work")
    expect(message).toContain("reissue again")
  })

  it("tells a head coach mid-reconnect the old authenticator may already be off", async () => {
    const message = await droppedMessage(() => <TwoFactorReconnectForm />, 0)
    expect(message).toContain("your old authenticator and recovery codes no longer work")
    expect(message).toContain("Reload this page before trying again")
  })
})

describe("the wrapper's contract", () => {
  type FieldState = { error: string | null; errorField: "password" | null }
  const copy = { subject: "Your sign-in", unconfirmed: "Check the connection and sign in again" }

  it("passes a settled action straight through", async () => {
    const action = resilientAction<CapturedState>(async () => ({ error: "Wrong password" }), copy)

    await expect(action({ error: null }, new FormData())).resolves
      .toEqual({ error: "Wrong password" })
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it("names the device when it is the one that is offline, without calling it a failure", async () => {
    vi.stubGlobal("navigator", { onLine: false })
    const action = resilientAction<CapturedState>(droppedRequest, copy)

    await expect(action({ error: null }, new FormData())).resolves.toEqual({
      error: "Your sign-in was not confirmed because this device is offline,"
        + " so it may or may not have gone through. Check the connection and sign in again.",
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
      error: `${unreachable("Your sign-in")}Check the connection and sign in again.`,
      errorField: null,
    })
  })

  it("says an expired sign-in changed nothing and is cleared by signing in", async () => {
    const expired = Object.assign(new Error("omitted in production"), {
      digest: "SMBA_SESSION_EXPIRED",
    })
    const action = resilientAction<CapturedState>(() => Promise.reject(expired), {
      ...copy,
      subject: "Your new PIN",
    })

    await expect(action({ error: null }, new FormData())).resolves.toEqual({
      error: "Your new PIN did not go through because your sign-in has expired. Nothing was changed."
        + " Sign in again in a new tab, then come back here and try again.",
    })
    // An expiry is an everyday event on a seven-day clock, not a fault.
    expect(reportClientError).not.toHaveBeenCalled()
  })

  /*
   * ST-2. Every authentication action reports success by redirecting, and a
   * Server Action redirect reaches the browser as a *rejection*: the reducer
   * calls `reject(createRedirectErrorForAction(...))` so React re-throws at the
   * `useActionState` and `RedirectBoundary` remounts the subtree. Folding that
   * into `error` swallowed the framework's own control flow -- it put
   * "NEXT_REDIRECT" in the form's `role="alert"` and wrote an
   * `unhandled_rejection` row for every successful sign-in.
   *
   * The errors are built by calling the real `redirect` and `notFound`, so the
   * test fails rather than rots if Next.js changes the shape it throws.
   */
  function thrownBy(call: () => never) {
    try {
      call()
    } catch (error) {
      return error
    }
    throw new Error("expected the Next.js API to throw")
  }

  it.each([
    { code: "NEXT_REDIRECT", name: "a redirect", throwIt: () => redirect("/coach") },
    { code: "NEXT_HTTP_ERROR_FALLBACK", name: "a not-found", throwIt: () => notFound() },
  ])("rethrows $name to the boundary that owns it", async ({ code, throwIt }) => {
    const control = thrownBy(throwIt as () => never)
    const action = resilientAction<CapturedState>(() => Promise.reject(control), copy)

    await expect(action({ error: null }, new FormData())).rejects.toBe(control)
    expect((control as { digest: string }).digest.startsWith(code)).toBe(true)
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it("reports a rejection that is not a transport failure instead of swallowing it", async () => {
    const fault = new Error("Cannot read properties of undefined")
    const action = resilientAction<CapturedState>(() => Promise.reject(fault), copy)

    // Plain advice, not the fault's own text: in a production build a server
    // fault's message is React's fixed "The specific message is omitted..."
    await expect(action({ error: null }, new FormData())).resolves.toEqual({
      error: "Your sign-in ran into an unexpected problem, so it may or may not have gone"
        + " through. Check the connection and sign in again.",
    })
    expect(reportClientError).toHaveBeenCalledWith({
      boundary: "window",
      error: fault,
      eventType: "unhandled_rejection",
    })
  })

  it("reports a bug in the page as a fault rather than blaming the connection", async () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'id')")
    const action = resilientAction<CapturedState>(() => Promise.reject(bug), copy)

    const next = await action({ error: null }, new FormData())
    expect(next.error).not.toContain("connection dropped")
    expect(reportClientError).toHaveBeenCalledWith({
      boundary: "window",
      error: bug,
      eventType: "unhandled_rejection",
    })
  })
})
