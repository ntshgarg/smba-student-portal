// The signed-in devices list, trusted browsers and reset request on /account/security.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/account/security/actions", () => ({
  cancelAuthenticatorResetRequestAction: vi.fn(),
  changePasswordAction: vi.fn(),
  forgetTrustedBrowsersAction: vi.fn(),
  reissueRecoveryCodesAction: vi.fn(),
  removePinAction: vi.fn(),
  revokeOtherSessionsAction: vi.fn(),
  revokeSessionAction: vi.fn(),
  savePinAction: vi.fn(),
}))
vi.mock("@/app/account/recovery-email/actions", () => ({
  confirmRecoveryEmailChange: vi.fn(),
  requestRecoveryEmailChange: vi.fn(),
}))
vi.mock("@/lib/telemetry/report-client-error", () => ({ reportClientError: vi.fn() }))

const { AccountSecurityWorkspace } = await import("@/components/account-security-workspace")
const { RecoveryEmailSecurityPanel } = await import("@/components/recovery-email-security-panel")

function session(id: string, createdAt: string, current = false) {
  return {
    createdAt,
    current,
    expiresAt: "2026-11-20T00:30:00.000Z",
    id,
    ipAddress: null,
    userAgent: "Macintosh",
  }
}

function render(props: Partial<Parameters<typeof AccountSecurityWorkspace>[0]> = {}) {
  return renderToStaticMarkup(
    <AccountSecurityWorkspace
      allowPin={false}
      authenticatorEnabled
      authenticatorRequired
      pinEnabled={false}
      pinRequired={false}
      sessions={[]}
      unusedRecoveryCodeCount={null}
      {...props}
    />,
  )
}

describe("the signed-in devices list", () => {
  it("shows this device, then the newest sign-ins, in the academy's clock", () => {
    const html = render({
      sessions: [
        // Newest first, as the page reads them.
        session("unrecognised", "2026-11-13T00:30:00.000Z"),
        session("recent", "2026-11-06T00:30:00.000Z"),
        session("middle", "2026-11-05T00:30:00.000Z"),
        session("old", "2026-11-04T00:30:00.000Z"),
        session("older", "2026-11-03T00:30:00.000Z"),
        session("this-one", "2026-11-02T00:30:00.000Z", true),
        session("oldest", "2026-11-01T00:30:00.000Z"),
      ],
    })
    const shown = [...html.matchAll(/Signed in ([^<]+)<\/span>/gu)].map((match) => match[1])
    expect(shown).toEqual([
      "2 November 2026 at 6:00 am",
      "13 November 2026 at 6:00 am",
      "6 November 2026 at 6:00 am",
      "5 November 2026 at 6:00 am",
      "4 November 2026 at 6:00 am",
    ])
    expect(html).toContain("Show all 7 devices")
    expect(html).toContain("Expires 20 November 2026 at 6:00 am")
  })
})

describe("trusted browsers and reset requests", () => {
  it("says how many browsers skip the code and until when, and offers to forget them", () => {
    const html = render({
      trustedBrowserExpiries: ["2026-11-20T06:30:00.000Z", "2026-12-10T06:30:00.000Z"],
    })
    expect(html).toContain("2 browsers skip the authenticator code.")
    expect(html).toContain("20 November 2026")
    expect(html).toContain("10 December 2026")
    expect(html).toContain("Forget trusted browsers")
  })

  it("shows a reset request waiting in the coach's name, with a way to cancel it", () => {
    const html = render({ pendingAuthenticatorResetRequestedAt: "2026-11-12T06:30:00.000Z" })
    expect(html).toContain("A reset request is waiting")
    expect(html).toContain("12 November 2026")
    expect(html).toContain("Cancel reset request")
  })
})

describe("the recovery email panel", () => {
  it("confirms a change once it has gone through", () => {
    const html = renderToStaticMarkup(
      <RecoveryEmailSecurityPanel changed maskedEmail="ne•••@example.com" requiresSecondFactor={false} />,
    )
    expect(html).toContain("Recovery email changed.")
  })
})
