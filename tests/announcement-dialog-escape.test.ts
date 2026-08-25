import { Children, isValidElement, type ReactElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CoachAnnouncementDetail } from "@/components/coach/announcements/contracts"

/**
 * G-15. Both announcement dialogs gated all five of their exits on `pending`,
 * and `pending` is only cleared when the server action settles. Next invokes a
 * server action through React's `callServer`, whose fetch carries no
 * `AbortSignal` (lib/client/network-failure.ts:28-40), so a connection that is
 * established but stalled — the courtside phone on one bar — never settles at
 * all: Escape, the backdrop, the close button and the cancel button were all
 * dead, and the composer's `isDirty` beforeunload guard made reload no way out
 * either. The coach was locked in with up to 5,000 characters.
 *
 * The exits are the first half. The second half is what the coach is told once
 * they use one: a deadline turns the indefinite hang into an answer, that answer
 * has to arrive on the surface the coach moved to, and the retry it invites has
 * to reach the same publication rather than post the notice a second time.
 *
 * The suite has no DOM, so React's own dispatch cannot be driven here. What can
 * be driven is the state each dialog renders from: `useState` is stubbed so
 * every boolean starts true, which is exactly the picture an in-flight action
 * paints — the review dialog open with `pending` set — and the component is then
 * called as a plain function so its real handlers can be read off the element
 * tree. That idiom is tests/route-recovery.test.tsx:60-77. Tests that need to
 * press a button rather than inspect one switch the stub to `idle`, which hands
 * every hook its real initial value, and re-render the dialog the surface put on
 * screen: `pending` false is the moment before the press.
 *
 * Every state setter records into one shared list, so "this exit dismissed the
 * dialog" is "this exit reached the parent's state at all": before the fix the
 * `if (!pending)` guards swallowed the call and the list stayed empty.
 */

const { controls } = vi.hoisted(() => {
  // The message the composer would destroy if reload were the only way out. Its
  // length is the point: 4,980 characters, just under the textarea's 5,000.
  const content = "Sunday coaching moves to Court 3 while the floor is relaid. ".repeat(83)
  const composed = {
    channels: ["homepage"],
    content,
    expiresOn: "",
    pinned: false,
    title: "Sunday coaching moves to Court 3",
  }
  // No announcement canonicalises to the empty string, so a composer holding it
  // has not yet minted a key for what is on screen.
  const unminted = { key: "6b1f4d0e-6f21-4a51-9a4e-2f0d5f2a77c3", payload: "" }
  const reason = "Court 3 is unavailable after all"

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
  }

  const controls = {
    composed,
    content,
    publication: { ...unminted } as { key: string; payload: unknown },
    /** Overridden by a test that needs the action to answer rather than hang. */
    publishReply: null as null | (() => Promise<unknown>),
    reason,
    /** Every ref handed out, so a dialog can be retired while its action runs. */
    refs: [] as Array<{ current: unknown }>,
    /** A connection that opened and then stopped: it neither resolves nor rejects. */
    stalled: () => new Promise<never>(() => {}),
    stateUpdates: [] as unknown[],
    steer: "in-flight" as "in-flight" | "idle",
    values: composed as Record<string, unknown>,
    withdrawReply: null as null | (() => Promise<unknown>),

    reset() {
      controls.publication = { ...unminted }
      controls.publishReply = null
      controls.refs.length = 0
      controls.stateUpdates.length = 0
      controls.steer = "in-flight"
      controls.values = composed
      controls.withdrawReply = null
    },

    /**
     * The state each component would hold mid-action. Steering by initial value
     * works because every one of these is unambiguous within its component: the
     * only booleans are `reviewing`/`published`/`pending` in the composer and
     * `pinPending`/`withdrawOpen`/`pending` in the detail, all of which start
     * false, and the only empty string is the withdrawal reason.
     */
    state(initial: unknown) {
      const value = typeof initial === "function" ? (initial as () => unknown)() : initial
      if (controls.steer === "idle") return value
      if (value === false) return true
      if (value === "") return controls.reason
      if (isRecord(value) && "payload" in value) return controls.publication
      if (isRecord(value) && "content" in value) return controls.values
      return value
    },
  }

  return { controls }
})

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useEffect: () => {},
    useRef: (initial: unknown) => {
      const ref = { current: initial === undefined ? null : initial }
      controls.refs.push(ref)
      return ref
    },
    useState: (initial: unknown) => [
      controls.state(initial),
      (next: unknown) => controls.stateUpdates.push(next),
    ],
  }
})

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }))

const guard = vi.hoisted(() => ({ navigateAfterCommit: vi.fn(() => true) }))

vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => ({
    confirmDiscard: () => true,
    confirmNavigation: () => true,
    navigateAfterCommit: guard.navigateAfterCommit,
  }),
}))

vi.mock("@/app/coach/announcements/actions", () => ({
  publishAnnouncementAction: () => (controls.publishReply ?? controls.stalled)(),
  setAnnouncementPinnedAction: () => controls.stalled(),
  withdrawAnnouncementAction: () => (controls.withdrawReply ?? controls.stalled)(),
}))

const { AnnouncementComposer } = await import(
  "@/components/coach/announcements/announcement-composer"
)
const { PublishedAnnouncementDetail } = await import(
  "@/components/coach/announcements/announcement-detail"
)

type AnyElement = ReactElement<Record<string, unknown>>

type Notice = { message: string; tone: string }

/** Both dialogs set this deadline; nothing is meant to arrive before it. */
const deadlineMs = 20_000

const announcement: CoachAnnouncementDetail = {
  audience: "everyone",
  channels: ["homepage"],
  content: "The academy will be closed on Monday.",
  expiresOn: null,
  id: "0f5f3a7c-4d2e-4c1a-9f18-9d3a2b6c1e40",
  pinned: false,
  presentationRevision: 0,
  publishedAt: "2026-08-24T04:30:00.000Z",
  publishedByAccountId: "coach-1",
  status: "active",
  title: "Academy holiday",
  withdrawal: null,
}

function composer() {
  return AnnouncementComposer({ academyToday: "2026-08-24" })
}

function detail() {
  return PublishedAnnouncementDetail({ announcement, backHref: "/coach/announcements" })
}

function descendants(node: ReactNode): AnyElement[] {
  if (!isValidElement(node)) return []
  const element = node as AnyElement
  return [
    element,
    ...Children.toArray(element.props.children as ReactNode).flatMap(descendants),
  ]
}

/** The child element the surface hands `marker` to, rendered as a plain call. */
function openDialog(surface: ReactNode, marker: string) {
  const host = descendants(surface).find((element) => (
    typeof element.type === "function" && marker in element.props
  ))
  if (!host) throw new Error(`No element carrying ${marker} is on screen`)
  const render = host.type as (props: Record<string, unknown>) => ReactNode
  return { host, tree: render(host.props) }
}

/**
 * The same dialog with its own state at rest, so its buttons can be pressed.
 * The props are still the ones the surface passed, which is the point: the
 * handlers pressed here close over the parent's real callbacks.
 */
function openIdleDialog(surface: ReactNode, marker: string) {
  const { host } = openDialog(surface, marker)
  controls.steer = "idle"
  // Reading the props above already rendered this dialog once. Only the refs of
  // the render whose handlers are pressed below belong to the dialog on screen.
  controls.refs.length = 0
  const render = host.type as (props: Record<string, unknown>) => ReactNode
  return { host, tree: render(host.props) }
}

function element(tree: ReactNode, match: (element: AnyElement) => boolean) {
  const found = descendants(tree).find(match)
  if (!found) throw new Error("No matching element is on screen")
  return found
}

/** The visible text of a control, ignoring the icon elements beside it. */
function captionOf(control: AnyElement) {
  return descendants(control)
    .flatMap((node) => Children.toArray(node.props.children as ReactNode))
    .filter((child): child is string => typeof child === "string")
    .join("")
    .trim()
}

function button(tree: ReactNode, caption: string) {
  return element(tree, (node) => node.type === "button" && captionOf(node) === caption)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** The notice a run of state updates put on screen, whichever surface owns it. */
function noticeIn(updates: unknown[]) {
  return updates.find((update): update is Notice => (
    isRecord(update) && typeof update.message === "string" && typeof update.tone === "string"
  ))
}

function publicationIn(updates: unknown[]) {
  return updates.find((update): update is { key: string; payload: unknown } => (
    isRecord(update) && "payload" in update && "key" in update
  ))
}

function press(control: AnyElement) {
  controls.stateUpdates.length = 0;
  (control.props.onClick as () => void)()
  return [...controls.stateUpdates]
}

/**
 * Presses a control whose handler starts a server action. The update list is
 * cleared after the press because `pending` and the cleared notice are set
 * synchronously, before the first await; everything recorded from here on
 * arrives when the request finally answers.
 */
function startAction(control: AnyElement) {
  const settled = (control.props.onClick as () => Promise<void>)()
  controls.stateUpdates.length = 0
  return settled
}

/**
 * Starts an action and returns only what its outcome wrote by `elapsedMs`.
 * `advanceTimersByTimeAsync` crosses a real macrotask boundary, so the whole
 * microtask chain behind the answer has already run by the time it returns.
 * The action's own promise is deliberately not awaited: a dialog that sets no
 * deadline never settles, and that has to read as an answer that never came
 * rather than as a suite that hung.
 */
async function pressAndWait(control: AnyElement, elapsedMs: number) {
  startAction(control)
  await vi.advanceTimersByTimeAsync(elapsedMs)
  return [...controls.stateUpdates]
}

/**
 * The ref a dialog keeps to know it has left the screen. Effects do not run in
 * this harness, so it still holds the `false` it was created with; setting it is
 * what the effect cleanup does when the coach takes one of the exits above while
 * the request is still running.
 */
function retireDialog() {
  const dismissed = controls.refs.filter((ref) => ref.current === false)
  expect(dismissed).toHaveLength(1)
  dismissed[0].current = true
}

function pressEscape(dialog: AnyElement) {
  const event = { preventDefault: vi.fn() }
  controls.stateUpdates.length = 0;
  (dialog.props.onCancel as (event: unknown) => void)(event)
  // The dialog element cancels the browser's own close so the surface owns the
  // teardown; if that were dropped the assertion below would pass on a dialog
  // that had already vanished from under the check.
  expect(event.preventDefault).toHaveBeenCalledOnce()
  return [...controls.stateUpdates]
}

function pressBackdrop(dialog: AnyElement) {
  const backdrop = {}
  controls.stateUpdates.length = 0;
  (dialog.props.onMouseDown as (event: unknown) => void)({
    currentTarget: backdrop,
    target: backdrop,
  })
  return [...controls.stateUpdates]
}

beforeEach(() => {
  controls.reset()
  guard.navigateAfterCommit.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("announcement dialogs during a stalled action", () => {
  it("leaves every exit from the review dialog live while a publish is in flight", () => {
    const { tree } = openDialog(composer(), "onPublished")
    const dialog = element(tree, (node) => node.type === "dialog")
    const close = element(tree, (node) => (
      node.props["aria-label"] === "Back to announcement editor"
    ))

    // The publish itself is the one thing that stays held, so a stalled attempt
    // is not joined by a second one from the same dialog.
    expect(button(tree, "Publishing…").props.disabled).toBe(true)

    expect(pressEscape(dialog)).toEqual([false])
    expect(pressBackdrop(dialog)).toEqual([false])
    expect(press(close)).toEqual([false])
    expect(press(button(tree, "Back to edit"))).toEqual([false])

    expect(close.props.disabled ?? false).toBe(false)
    expect(button(tree, "Back to edit").props.disabled ?? false).toBe(false)
  })

  it("leaves every exit from the withdrawal dialog live while a withdrawal is in flight", () => {
    const { tree } = openDialog(detail(), "onWithdrawn")
    const dialog = element(tree, (node) => node.type === "dialog")
    const close = element(tree, (node) => (
      node.props["aria-label"] === "Close withdrawal dialog"
    ))

    expect(button(tree, "Withdrawing…").props.disabled).toBe(true)

    expect(pressEscape(dialog)).toEqual([false])
    expect(pressBackdrop(dialog)).toEqual([false])
    expect(press(close)).toEqual([false])
    expect(press(button(tree, "Keep announcement"))).toEqual([false])

    expect(close.props.disabled ?? false).toBe(false)
    expect(button(tree, "Keep announcement").props.disabled ?? false).toBe(false)
  })

  it("keeps the message and its publication key outside the review dialog", () => {
    const surface = composer()
    const { host, tree } = openDialog(surface, "onPublished")

    // Leaving is only safe if the retry it invites is the same publication. The
    // key is minted by the composer and handed down, so a dismissed dialog does
    // not take it with it and `publishAnnouncement` recognises the second
    // request as the first one.
    expect(host.props.publicationKey).toBe(controls.publication.key)
    expect(element(tree, (node) => node.props.id === "announcement-review-title"))
      .toBeDefined()

    // And the 4,950 characters behind the dialog are the composer's, not the
    // dialog's, so dismissing it cannot discard them.
    expect(element(surface, (node) => node.props.id === "announcement-content").props.value)
      .toBe(controls.content)
  })

  it("keeps the withdrawal reason outside the withdrawal dialog", () => {
    const { host, tree } = openDialog(detail(), "onWithdrawn")

    // `withdrawAnnouncement` deduplicates a repeated withdrawal on the reason
    // itself, so a reason that survives dismissal is what makes the retry after
    // a stall report "already withdrawn" instead of failing on a reworded one.
    expect(host.props.reason).toBe(controls.reason)
    expect(element(tree, (node) => node.props.name === "withdrawalReason").props.value)
      .toBe(controls.reason)
  })
})

describe("announcement dialogs past their deadline", () => {
  it("answers a stalled publish with the unknown-outcome copy, not a failure", async () => {
    vi.useFakeTimers()
    const { tree } = openIdleDialog(composer(), "onPublished")
    startAction(button(tree, "Publish announcement"))

    // Nothing is invented while the request could still answer for itself.
    await vi.advanceTimersByTimeAsync(deadlineMs - 1)
    expect(noticeIn(controls.stateUpdates)).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1)
    const answered = noticeIn(controls.stateUpdates)
    // The write was never cancelled, so this is deliberately not "it failed".
    expect(answered?.message)
      .toContain("was not confirmed in time and may or may not have been recorded")
    expect(answered?.message).toContain("Your message is still here")
    expect(answered?.tone).toBe("error")
  })

  it("answers a stalled withdrawal with the unknown-outcome copy", async () => {
    vi.useFakeTimers()
    const { tree } = openIdleDialog(detail(), "onWithdrawn")

    const answered = noticeIn(
      await pressAndWait(button(tree, "Withdraw announcement"), deadlineMs),
    )

    expect(answered?.message)
      .toContain("was not confirmed in time and may or may not have been recorded")
    expect(answered?.message).toContain("Your reason is still here")
    expect(answered?.tone).toBe("error")
  })
})

describe("an announcement action that settles after its dialog is gone", () => {
  it("reports a stalled publish on the composer the coach went back to", async () => {
    vi.useFakeTimers()
    const { tree } = openIdleDialog(composer(), "onPublished")
    const publish = button(tree, "Publish announcement")
    retireDialog()

    // The dialog's own notice is unmounted by now, so an answer that lands here
    // is only readable if it is handed back to the composer.
    const answered = noticeIn(await pressAndWait(publish, deadlineMs))

    expect(answered?.message)
      .toContain("was not confirmed in time and may or may not have been recorded")
    expect(answered?.tone).toBe("error")
  })

  it("tells the composer a late publish went live instead of leaving it silent", async () => {
    vi.useFakeTimers()
    controls.publishReply = () => Promise.resolve({
      announcement: { id: announcement.id },
      ok: true,
      reusedPublication: false,
    })
    const { tree } = openIdleDialog(composer(), "onPublished")
    const publish = button(tree, "Publish announcement")
    retireDialog()

    const updates = await pressAndWait(publish, 0)

    expect(noticeIn(updates)?.tone).toBe("success")
    expect(noticeIn(updates)?.message).toContain("does not need sending again")
    // Published, so the beforeunload guard stops asking the coach to discard a
    // notice the academy can already read.
    expect(updates).toContain(true)
    // And no navigation: the coach is typing somewhere behind this, and the
    // whole reason the exits were opened was to stop yanking them around.
    expect(guard.navigateAfterCommit).not.toHaveBeenCalled()
  })

  it("reports a stalled withdrawal on the detail page the dialog closed over", async () => {
    vi.useFakeTimers()
    const { tree } = openIdleDialog(detail(), "onWithdrawn")
    const withdraw = button(tree, "Withdraw announcement")
    retireDialog()

    const answered = noticeIn(await pressAndWait(withdraw, deadlineMs))

    expect(answered?.message)
      .toContain("was not confirmed in time and may or may not have been recorded")
    expect(answered?.tone).toBe("error")
  })
})

describe("the publication key a retry reuses", () => {
  function reviewButton(surface: ReactNode) {
    return button(surface, "Review announcement")
  }

  it("survives an edit that leaves the announcement the server would fingerprint", () => {
    const minted = publicationIn(press(reviewButton(composer())))
    expect(minted?.key).toBeTypeOf("string")
    expect(minted?.key).not.toBe(controls.publication.key)

    // Commit that state by hand — nothing re-renders in this harness — and come
    // back with an equal but freshly allocated `values`, which is what every
    // keystroke produces: `updateValues` spreads a new object each time. Typing
    // a character and deleting it again is this exact shape.
    controls.publication = minted as { key: string; payload: unknown }
    controls.values = { ...controls.composed }

    // Reminting here would publish a second identical notice on the retry the
    // reopened exits invite, and published content is immutable: the only way
    // back is a permanently audited withdrawal.
    const second = press(reviewButton(composer()))
    expect(publicationIn(second)).toBeUndefined()
    expect(second).toEqual([true])
  })

  it("is reminted once the announcement itself changes", () => {
    const minted = publicationIn(press(reviewButton(composer())))
    controls.publication = minted as { key: string; payload: unknown }
    controls.values = { ...controls.composed, title: "Sunday coaching moves to Court 4" }

    // The server rejects a reused key outright once the fingerprint disagrees,
    // so reuse has to end exactly where the announcement changes.
    expect(publicationIn(press(reviewButton(composer())))?.key).not.toBe(minted?.key)
  })
})
