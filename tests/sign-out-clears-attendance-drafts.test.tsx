import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Unsaved attendance marks are kept on the device for the coach who made them.
 * Signing out hands the device on, so every way out of the portal clears them
 * before the session goes.
 *
 * The suite has no DOM, so the JSX factory records each form as it is created
 * and its submit handler is called the way a browser would before the action.
 */
const captured = vi.hoisted(() => ({
  clearAttendanceDrafts: vi.fn(),
  forms: [] as Array<Record<string, unknown>>,
}))

vi.mock("react/jsx-dev-runtime", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react/jsx-dev-runtime")
  const jsxDEV = actual.jsxDEV as (...args: never[]) => unknown
  return {
    ...actual,
    jsxDEV(type: never, props: never, ...rest: never[]) {
      if (type === "form") captured.forms.push(props as Record<string, unknown>)
      return jsxDEV(type, props, ...rest)
    },
  }
})

vi.mock("@/app/login/actions", () => ({ clearSession: vi.fn() }))
vi.mock("@/components/motion/use-presence", () => ({
  // The menu renders its items only once opened; render it opened.
  usePresence: () => ({ mounted: true, state: "open" }),
}))
vi.mock("@/lib/client/attendance-draft-storage", () => ({
  clearAttendanceDrafts: captured.clearAttendanceDrafts,
}))

const { AccountMenu } = await import("@/components/account-menu")
const { InterstitialSignOut } = await import("@/components/interstitial-sign-out")

const coach = { firstName: "Sathiya", fullName: "Sathiya Moorthy", initials: "SM" }

function submitTheOnlyForm() {
  expect(captured.forms).toHaveLength(1)
  ;(captured.forms[0].onSubmit as () => void)()
}

afterEach(() => {
  captured.clearAttendanceDrafts.mockReset()
  captured.forms.length = 0
})

describe("signing out clears unsaved attendance marks from the device", () => {
  it("from the portal account menu", () => {
    renderToStaticMarkup(<AccountMenu account={coach} publicSiteHref="/" />)
    submitTheOnlyForm()
    expect(captured.clearAttendanceDrafts).toHaveBeenCalledOnce()
  })

  it("from the account menu while previewing, whose exit also signs out", () => {
    renderToStaticMarkup(<AccountMenu account={coach} previewMode publicSiteHref="/" />)
    submitTheOnlyForm()
    expect(captured.clearAttendanceDrafts).toHaveBeenCalledOnce()
  })

  it("from a forced-enrolment page", () => {
    renderToStaticMarkup(<InterstitialSignOut />)
    submitTheOnlyForm()
    expect(captured.clearAttendanceDrafts).toHaveBeenCalledOnce()
  })
})
