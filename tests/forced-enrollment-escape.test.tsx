import { Children, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import type { RecoveryEmailEnrollmentState } from "@/app/account/recovery-email/actions"

/**
 * G-16. /account/recovery-email/setup is a redirect target, not a destination:
 * app/coach/layout.tsx:27, app/(student)/layout.tsx:32 and app/admin/page.tsx:35
 * all bounce into it, and nothing else opens until the address is verified.
 *
 * Two ways out were missing. The code-entry step could never be left, because
 * `useActionState` has no setter and every confirm failure in
 * app/account/recovery-email/actions.ts returns `sent: true` (:84, :133, :218,
 * :274) -- so a mistyped address was permanent. And the page had no sign-out, so
 * the phone in the coach's hand could not be passed to someone who could finish.
 * Together that is a head coach locked out of the courtside registers mid-session.
 *
 * The suite has no DOM, so the two hooks the component uses are stubbed and the
 * component is called as a plain function: that returns the element tree, which
 * is where the press handler lives, and rendering that tree gives the markup.
 * The pages are async server components, awaited and rendered the same way.
 */

type CapturedAction = (
  state: RecoveryEmailEnrollmentState,
  payload: FormData,
) => Promise<RecoveryEmailEnrollmentState>

const { clearSession, hooks, reportClientError } = vi.hoisted(() => ({
  clearSession: vi.fn(),
  hooks: {
    /** Every wrapped action `useActionState` was handed, in call order. */
    actions: [] as CapturedAction[],
    /** `useState` cells, kept across renders so a press survives to the next one. */
    cells: [] as unknown[],
    cursor: 0,
    /**
     * Whether the component under test is the thing currently calling `useState`.
     * `renderToStaticMarkup` renders next/link and lucide below it, and those get
     * React's own implementation rather than a cell in this store.
     */
    driving: false,
    /** One action state per `useActionState` call site, or null for the initial ones. */
    states: null as RecoveryEmailEnrollmentState[] | null,
  },
  reportClientError: vi.fn(),
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useActionState: (action: CapturedAction, initialState: RecoveryEmailEnrollmentState) => {
      const index = hooks.actions.length
      hooks.actions.push(action)
      return [hooks.states?.[index] ?? initialState, () => {}, false]
    },
    useState: (initial: unknown) => {
      if (!hooks.driving) return actual.useState(initial)
      const index = hooks.cursor++
      if (hooks.cells.length <= index) hooks.cells.push(initial)
      const value = hooks.cells[index]
      return [value, (next: unknown) => {
        hooks.cells[index] = typeof next === "function" ? next(value) : next
      }]
    },
  }
})

vi.mock("server-only", () => ({}))
vi.mock("@/lib/telemetry/report-client-error", () => ({ reportClientError }))
vi.mock("@/app/login/actions", () => ({ clearSession }))

/**
 * The three pages read a session and a credential before they render anything.
 * The fixture below is the state each one exists to answer: a head coach who is
 * signed in and has not finished the credential that page is the gate for. A
 * redirect from any of them means the fixture missed, so it fails loudly rather
 * than leaving an empty tree to search.
 */
const redirect = vi.fn((destination: string) => {
  throw new Error(`the page redirected to ${destination} instead of rendering`)
})
const headCoach = {
  academyId: "SMBA-HC-0001",
  firstName: "Ishaan",
  fullName: "Ishaan Rao",
  initials: "IR",
  previewMode: false,
  role: "coach",
  subjectId: "coach-head",
}

vi.mock("next/navigation", () => ({ redirect }))
vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: async () => headCoach },
}))
vi.mock("@/lib/auth/session", () => ({
  getRawAuthSession: async () => ({ user: { id: headCoach.subjectId, twoFactorEnabled: false } }),
}))
vi.mock("@/lib/auth/recovery-service", () => ({ getRecoveryEmail: () => null }))
vi.mock("@/lib/auth/credential-service", () => ({ hasPinCredential: () => false }))
vi.mock("@/lib/auth/coach-access", () => ({
  getCoachAccessProfile: () => ({ accessLevel: "head_admin", coachAccountId: headCoach.subjectId }),
}))
vi.mock("@/lib/auth/post-auth-destination", () => ({ postAuthenticationDestination: () => "/coach" }))
vi.mock("@/lib/db/client", () => ({
  initializeDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: () => ({ role: "coach" }) }) }) }),
  }),
}))
vi.mock("@/app/account/recovery-email/actions", () => ({
  confirmCurrentRecoveryEmail: vi.fn(),
  requestCurrentRecoveryEmail: vi.fn(),
}))
vi.mock("@/app/auth/pin/actions", () => ({ setupPinAction: vi.fn(), skipPinSetupAction: vi.fn() }))
vi.mock("@/app/auth/two-factor/actions", () => ({
  confirmTotpSetup: vi.fn(),
  startTotpSetup: vi.fn(),
}))

const { InterstitialSignOut } = await import("@/components/interstitial-sign-out")
const { RecoveryEmailEnrollmentForm } = await import(
  "@/components/recovery-email-enrollment-form"
)

/** The address the coach meant to type, and the one they actually typed. */
const intended = "coach@example.com"
const mistyped = "coach@exampel.com"

const codeSent: RecoveryEmailEnrollmentState = { email: mistyped, error: null, sent: true }
const codeRefused: RecoveryEmailEnrollmentState = {
  email: mistyped,
  error: "That code is invalid or expired.",
  sent: true,
}

/** An action that resolves; the states on screen are supplied by the stub instead. */
const settles: CapturedAction = async (state) => state

/** Renders one pass of the component, keeping the `useState` cells from the last. */
function pass(states: RecoveryEmailEnrollmentState[] | null, action: CapturedAction = settles) {
  hooks.actions.length = 0
  hooks.cursor = 0
  hooks.states = states
  hooks.driving = true
  const tree = RecoveryEmailEnrollmentForm({ confirmAction: action, requestAction: action })
  hooks.driving = false
  return { actions: [...hooks.actions], markup: renderToStaticMarkup(tree), tree }
}

/** Every element in the tree the predicate accepts, in document order. */
function collect(
  node: ReactNode,
  matches: (element: ReactElement<Record<string, unknown>>) => boolean,
): Array<ReactElement<Record<string, unknown>>> {
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  const element = node as ReactElement<Record<string, unknown>>
  const found = matches(element) ? [element] : []

  for (const child of Children.toArray(node.props.children)) {
    found.push(...collect(child, matches))
  }

  return found
}

function press(tree: ReactNode, label: string) {
  const [control] = collect(tree, (element) =>
    element.type === "button" && element.props.children === label)
  expect(control, `no control labelled "${label}"`).toBeDefined()
  const onPress = control.props.onClick as () => void
  onPress()
}

beforeAll(() => {
  // `classifyNetworkFailure` reads `navigator.onLine` only to pick between the
  // offline and unreachable wordings. Pin it so the copy is stable.
  vi.stubGlobal("navigator", { onLine: true })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  hooks.actions.length = 0
  hooks.cells.length = 0
  hooks.cursor = 0
  hooks.driving = false
  hooks.states = null
  clearSession.mockClear()
  reportClientError.mockClear()
})

describe("a refused code does not trap the coach on the code step", () => {
  it("gives the address field back, with the mistyped address to correct", () => {
    const refused = pass([codeSent, codeRefused])
    expect(refused.markup).toContain('name="code"')
    expect(refused.markup).not.toContain('id="recovery-email"')

    press(refused.tree, "Use a different email")

    // Same two action results: `useActionState` has no setter, so nothing about
    // them can have changed. Only the component's own reading of them has.
    const restarted = pass([codeSent, codeRefused])
    expect(restarted.markup).toContain('id="recovery-email"')
    expect(restarted.markup).toContain('type="email"')
    expect(restarted.markup).toContain(`value="${mistyped}"`)
    expect(restarted.markup).not.toContain('name="code"')
    // The verdict on the retired code goes with it.
    expect(restarted.markup).not.toContain("That code is invalid or expired.")
  })

  it("keeps the address field up when the corrected address is refused", () => {
    press(pass([codeSent, codeRefused]).tree, "Use a different email")

    const rejected = pass([
      { email: "", error: "Enter a valid recovery email address.", sent: false },
      codeRefused,
    ])

    // The stale `sent: true` on the confirm result is the trap: it must not
    // close the address field again behind a request that never went out.
    expect(rejected.markup).toContain('id="recovery-email"')
    expect(rejected.markup).toContain("Enter a valid recovery email address.")
  })

  it("returns to the code step for the corrected address, not the mistyped one", () => {
    press(pass([codeSent, codeRefused]).tree, "Use a different email")

    const resent = pass([{ email: intended, error: null, sent: true }, codeRefused])

    expect(resent.markup).toContain('name="code"')
    expect(resent.markup).toContain(`value="${intended}"`)
    // The hidden field is what the confirm action verifies against. The mistyped
    // address reaching it would refuse every code the coach could possibly enter.
    expect(resent.markup).not.toContain(mistyped)
  })

  it("keeps the address field up when the corrected address never leaves the phone", async () => {
    press(pass([codeSent, codeRefused]).tree, "Use a different email")

    const dropped = () => Promise.reject(new TypeError("Failed to fetch"))
    const [send] = pass([codeSent, codeRefused], dropped).actions
    const folded = await send(codeSent, new FormData())

    // `resilientAction` folds a dropped request onto the state it was given --
    // here the retired result, whose `sent: true` would otherwise ride the
    // failure back onto the code step for the address just walked away from.
    expect(folded.sent).toBe(false)
    expect(folded.error).toContain("No verification code was sent")
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it("keeps the code step on the corrected address when the code never leaves the phone", async () => {
    press(pass([codeSent, codeRefused]).tree, "Use a different email")
    const resent: RecoveryEmailEnrollmentState = { email: intended, error: null, sent: true }

    // The same drop, on the other half of the mechanism. React hands the confirm
    // action the state that hook is holding, and after the retirement that is
    // still the refused result for the mistyped address -- so a default fold
    // returns a new, therefore live, object carrying that address back.
    const dropped = () => Promise.reject(new TypeError("Failed to fetch"))
    const [, confirm] = pass([resent, codeRefused], dropped).actions
    const folded = await confirm(codeRefused, new FormData())
    const retry = pass([resent, folded])

    expect(retry.markup).toContain('name="code"')
    // The hidden field is what the confirm action verifies against, and the
    // copy above it is the coach's only way to notice. The mistyped address in
    // either one refuses every code they can enter.
    expect(retry.markup).toContain(`value="${intended}"`)
    expect(retry.markup).not.toContain(mistyped)
    expect(retry.markup).toContain("The code was not used and is still valid")
    expect(reportClientError).not.toHaveBeenCalled()
  })
})

describe("a forced-enrolment interstitial can be handed to someone else", () => {
  it("really signs out rather than only saying so", () => {
    const control = InterstitialSignOut()
    const [form] = collect(control, (element) =>
      element.type === "form" && element.props.action === clearSession)
    // Markup alone would pass on a button that posts nowhere: `clearSession` is
    // the identity of the thing, and it is the action the portal account menu
    // already submits.
    expect(form, "the sign-out submits something other than clearSession").toBeDefined()

    const [button] = collect(form, (element) =>
      element.type === "button" && element.props.type === "submit")
    expect(button, "the sign-out form has no submit control").toBeDefined()
    expect(renderToStaticMarkup(control)).toContain("Sign out")
  })

  it("closes the recovery-email gate", async () => {
    const { default: RecoveryEmailSetupPage } = await import(
      "@/app/account/recovery-email/setup/page"
    )
    expectSignOut(await RecoveryEmailSetupPage())
  })

  it("closes the PIN gate", async () => {
    const { default: PinSetupPage } = await import("@/app/auth/pin/setup/page")
    expectSignOut(await PinSetupPage())
  })

  it("closes the authenticator gate", async () => {
    const { default: TwoFactorSetupPage } = await import("@/app/auth/two-factor/setup/page")
    expectSignOut(await TwoFactorSetupPage({ searchParams: Promise.resolve({}) }))
  })
})

/** The page mounts the sign-out, and it survives into the page's own markup. */
function expectSignOut(page: ReactElement) {
  expect(
    collect(page, (element) => element.type === InterstitialSignOut),
    "the interstitial mounts no sign-out",
  ).toHaveLength(1)
  expect(renderToStaticMarkup(page)).toContain("Sign out")
}
