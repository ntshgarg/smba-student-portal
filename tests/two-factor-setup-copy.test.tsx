import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

/*
 * The password gate in front of authenticator enrolment is reached by a head
 * coach and by the platform owner, and the owner meets it minutes after
 * provisioning. It used to tell both of them they were confirming control of
 * "the coach account", which is false for one of the two on their first real
 * screen in the product.
 */

const unusedAction = () => Promise.reject(new Error("The actions are never dispatched here."))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    // `setup: null` keeps the render on the password step, which is the one
    // that carries the sentence under test.
    useActionState: () => [{ error: null, setup: null }, () => {}, false],
  }
})

vi.mock("@/app/auth/two-factor/actions", () => ({
  confirmTotpSetup: unusedAction,
  startTotpSetup: unusedAction,
}))

const { TwoFactorSetupForm } = await import("@/components/two-factor-setup-form")

describe("the authenticator gate names the account it is protecting", () => {
  it("says coach to a head coach", () => {
    const html = renderToStaticMarkup(<TwoFactorSetupForm role="coach" />)
    expect(html).toContain("This confirms that you control the coach account.")
    expect(html).not.toContain("platform owner")
  })

  it("says platform owner to the platform owner", () => {
    const html = renderToStaticMarkup(<TwoFactorSetupForm role="platform_admin" />)
    expect(html).toContain("This confirms that you control the platform owner account.")
    expect(html).not.toContain("the coach account")
  })
})
