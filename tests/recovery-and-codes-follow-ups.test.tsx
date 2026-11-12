import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Follow-ups on the recovery and recovery-code screens (M049, M036): a reset
 * link that runs out while the form is open, and a second press of Reissue
 * that used to wipe the only readable copy of a live set.
 */

type AnyState = Record<string, unknown> & { error: string | null }
type CapturedAction = (state: AnyState, payload: FormData) => Promise<AnyState>

const mocks = vi.hoisted(() => ({
  actionSites: [] as Array<{ action: CapturedAction; initialState: AnyState }>,
  completePasswordRecovery: vi.fn(),
  cookieDelete: vi.fn(),
  reissueRecoveryCodesAction: vi.fn(),
  renderedState: null as Record<string, unknown> | null,
}))

vi.mock("server-only", () => ({}))
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useActionState: (action: CapturedAction, initialState: AnyState) => {
      mocks.actionSites.push({ action, initialState })
      return [mocks.renderedState ?? initialState, () => {}, false]
    },
  }
})
vi.mock("next/headers", () => ({
  cookies: async () => ({ delete: mocks.cookieDelete, get: () => ({ value: "token" }) }),
  headers: async () => new Headers(),
}))
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  redirect: vi.fn(),
}))
vi.mock("@/lib/auth/recovery-service", () => ({
  completePasswordRecovery: mocks.completePasswordRecovery,
  RECOVERY_SESSION_COOKIE: "recovery",
  requestPasswordRecovery: vi.fn(),
  verifyPasswordRecoverySecondFactor: vi.fn(),
}))
vi.mock("@/lib/auth/credential-service", () => ({ validateNewPassword: () => null }))
vi.mock("@/lib/auth/security-context", () => ({ requestSecurityContext: () => ({}) }))
vi.mock("@/lib/telemetry/report-client-error", () => ({ reportClientError: vi.fn() }))
vi.mock("@/app/account/security/actions", () => ({
  changePasswordAction: vi.fn(),
  reissueRecoveryCodesAction: mocks.reissueRecoveryCodesAction,
  removePinAction: vi.fn(),
  revokeOtherSessionsAction: vi.fn(),
  revokeSessionAction: vi.fn(),
  savePinAction: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.actionSites.length = 0
  mocks.renderedState = null
})

describe("a reset link that ran out while the new-password form was open", () => {
  function passwordData() {
    const formData = new FormData()
    formData.set("password", "A brand new secure password!")
    formData.set("confirmPassword", "A brand new secure password!")
    return formData
  }

  it("says so, and allows that the reset may already have gone through", async () => {
    mocks.completePasswordRecovery.mockResolvedValue(false)
    const { completePasswordRecoveryAction } = await import("@/app/recover/actions")

    const result = await completePasswordRecoveryAction(
      { error: null, errorField: null },
      passwordData(),
    )
    expect(result).toEqual({
      error: "This reset link has expired or has already been used."
        + " If you have just reset your password, sign in with the new one.",
      errorField: null,
      linkExpired: true,
    })
  })

  it("offers a new link from the form itself", async () => {
    const { RecoveryPasswordForm } = await import("@/components/recovery-reset-forms")
    mocks.renderedState = {
      error: "This reset link has expired or has already been used.",
      errorField: null,
      linkExpired: true,
    }

    const markup = renderToStaticMarkup(<RecoveryPasswordForm />)
    expect(markup).toContain('href="/recover"')
    expect(markup).toContain("Request another link")
  })

  it("does not offer one while the link is live", async () => {
    const { RecoveryPasswordForm } = await import("@/components/recovery-reset-forms")

    expect(renderToStaticMarkup(<RecoveryPasswordForm />)).not.toContain("Request another link")
  })
})

describe("pressing Reissue again after a set is on screen", () => {
  const shown = ["AAAA-1111", "BBBB-2222"]

  async function reissueAction() {
    const { AccountSecurityWorkspace } = await import("@/components/account-security-workspace")
    renderToStaticMarkup(
      <AccountSecurityWorkspace
        allowPin
        authenticatorEnabled
        authenticatorRequired
        pinEnabled
        pinRequired={false}
        sessions={[]}
        unusedRecoveryCodeCount={10}
      />,
    )
    // Call order: password, PIN, PIN removal, recovery codes.
    return mocks.actionSites[3]!.action
  }

  it("keeps the codes on screen when the press was refused before the set changed", async () => {
    mocks.reissueRecoveryCodesAction.mockResolvedValue({
      codes: null,
      error: "Enter your current password.",
      errorField: "currentPassword",
      storedSetUnchanged: true,
    })
    const action = await reissueAction()

    const next = await action({ codes: shown, error: null, errorField: null }, new FormData())
    expect(next).toMatchObject({ codes: shown, error: "Enter your current password." })
    // The codes are the coach's only copy; they are not sent back to the server.
    expect(mocks.reissueRecoveryCodesAction).toHaveBeenCalledWith(
      expect.objectContaining({ codes: null }),
      expect.any(FormData),
    )
  })

  it("clears them when the set may have been replaced", async () => {
    mocks.reissueRecoveryCodesAction.mockResolvedValue({
      codes: null,
      error: "The recovery codes could not be reissued. Try again.",
      errorField: null,
    })
    const action = await reissueAction()

    const next = await action({ codes: shown, error: null, errorField: null }, new FormData())
    expect(next.codes).toBeNull()
  })

  it("warns that a later reissue, here or elsewhere, retires the set on screen", async () => {
    const { AccountSecurityWorkspace } = await import("@/components/account-security-workspace")
    mocks.renderedState = { codes: shown, error: null, errorField: null, success: null }

    const markup = renderToStaticMarkup(
      <AccountSecurityWorkspace
        allowPin={false}
        authenticatorEnabled
        authenticatorRequired
        pinEnabled={false}
        pinRequired={false}
        sessions={[]}
        unusedRecoveryCodeCount={10}
      />,
    )
    expect(markup).toContain("AAAA-1111")
    expect(markup).toContain("here or on another device, these stop working")
  })
})
