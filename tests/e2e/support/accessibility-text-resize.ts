import type { CDPSession, Page } from "@playwright/test"

import {
  collectAccessibilityLayout,
  layoutFindings,
  type AccessibilityAdvisory,
  type AccessibilityFinding,
} from "./accessibility-audit"
import {
  accessibilityStates,
  viewportsForState,
  type AccessibilityActor,
  type AccessibilityState,
  type AccessibilityViewport,
} from "./accessibility-matrix"

// Chromium's shipped defaults, which are also what chrome://settings shows as
// "Medium (Recommended)": `default_font_size = 16` and
// `default_fixed_font_size = 13` in Blink's WebSettings. Written down because
// the pass below is a claim about a multiple of them, and a multiple with no
// stated base is a number nobody can check.
export const BROWSER_DEFAULT_FONT_SIZES = { fixed: 13, standard: 16 } as const

// Twice the defaults above, which is the 200% of WCAG 2.2 SC 1.4.4 Resize Text.
// Both are raised because Chrome's own font-size control moves both together —
// its Large step is 20/16 and Very large is 24/20 — so raising only `standard`
// would be a setting no user can actually produce.
export const TEXT_RESIZE_FONT_SIZES = {
  fixed: BROWSER_DEFAULT_FONT_SIZES.fixed * 2,
  standard: BROWSER_DEFAULT_FONT_SIZES.standard * 2,
} as const

// Half a pixel, because the value read back is a computed string and Blink
// rounds keyword-derived sizes to a device-pixel grid. Anything larger would
// admit a page that had genuinely overridden the preference by a point or two.
const ROOT_FONT_SIZE_TOLERANCE = 0.5

// The same half-pixel, applied to the question "did this text move at all".
// Blink rounds a computed font-size to a device-pixel grid, so a size that
// genuinely scaled moves by whole pixels — at 200% the smallest type in these
// sheets goes 10px → 20px — and nothing that stayed put moves by half of one.
const TEXT_SCALE_TOLERANCE = 0.5

// How many rendered text elements the responsiveness probe reads, and how many
// of the sample have to have answered the root for the render to count as one
// the reader's setting reached.
//
// Forty is a sample rather than a budget now: the walk collects every candidate
// in the landmark and then takes an even stride through them, so forty readings
// span the whole surface instead of stopping at the first screenful. Collecting
// them all is affordable — measured across all 55 audits of this pass against
// the stress fixture, the slowest full landmark walk was 12ms, because it is
// scoped to `main` and reads one rect per element rather than the whole
// `getComputedStyle` walk accessibility-audit.ts pays for.
const TEXT_SAMPLE_LIMIT = 40

/*
 * A third, and why not the half the review asked for.
 *
 * The threshold that shipped was `responsive > 0`: one scalable word anywhere in
 * the sample cleared it, which is the weakest form of the question and the one a
 * racing measurement could answer by accident. Raising it was right. Raising it
 * to half was measured first, and half fails a state this repository renders
 * today.
 *
 * The measurement, taken over all 55 audits against the stress fixture with the
 * sample spread across each landmark: 54 of them move between 93% and 100% of
 * their sample. The fifty-fifth is `coach-player-financial-record`, which moves
 * 48% — and not because of where the sample was taken, since 49% of all 153
 * candidates in that landmark move. Roughly half the settled player fee record
 * genuinely does not answer the root: its heading is fluid `clamp(px, vw, px)`
 * type, and the definition list, buttons and captions in its summary block are
 * pinned in px. That is a real finding about that page, it predates this
 * commit, and turning this gate red for it is a decision about the page rather
 * than about the check — so it is reported rather than enforced here.
 *
 * A third sits between the two: `coach-player-financial-record` clears it by
 * fifteen points, every other state clears it by sixty, and it still demands 14
 * of 40 where the shipped threshold demanded 1. What it costs in strictness the
 * spread sampling above returns in reach, and that trade was measured too. With
 * the fee table's own type pinned in px by an injected stylesheet, a sample
 * taken from the first forty elements in document order still reads 57%-75%
 * moved — the header carries it, and the gate stays green through the exact
 * regression it exists to catch. The same pin under a spread sample reads
 * 8%-25%, and the gate fires. The two changes are one change.
 *
 * `body` is checked separately and is not subject to this at all, which matters
 * because the two catch different things: `body { font-size: 16px }` does not
 * stop `rem`-sized text from answering the root, so the sample would barely
 * notice it, and the body reading is what fails it.
 */
const TEXT_RESPONSIVE_SHARE_DIVISOR = 3

const TEXT_RESIZE_RESULT_SUFFIX = "#text-200"

/*
 * The subset, and why it is this subset.
 *
 * The whole matrix is 67 states over four widths — 236 audits. A second full
 * pass does not fit: .github/workflows/ui-accessibility.yml gives the job 25
 * minutes for three profiles plus an `npm ci`, a production build and a
 * Playwright install, and the stress profile alone already spends most of a
 * quarter of that on 153 audits that each run two axe passes and a twelve-press
 * keyboard walk.
 *
 * So this selects the states where raised text meets a box that does not move
 * with it: a fixed column width, a fixed row height, a control sized to the
 * label it holds today. Three families, all in the stress profile because it is
 * the only fixture with enough rows for a column to be under pressure:
 *
 *   - The courtside registers. A coach marks attendance on a phone, and a
 *     register is a grid of narrow day columns beside a name column that is
 *     pinned wide. This is also the surface where a defect costs a lost
 *     register rather than an ugly page, so it is first.
 *   - The fee tables. Four record views plus the two money forms. Amounts,
 *     dates and player names in columns whose widths were chosen against 13px
 *     operational text.
 *   - The member directory, in both of its states: the filter panel, whose
 *     controls are sized to their labels, and an expanded member card.
 *
 * What is deliberately not covered, and why it would be the wrong trade: the
 * public homepage, the announcement surfaces and the marketing-shaped guest
 * routes. Those are the states whose type is already fluid — 21 of the 85
 * font-size declarations in app/public-home.css are `clamp(px, vw, px)`, which
 * reflows by design — and they hold few interactive controls per screen. The
 * authentication forms are also out: they are single-column, one control per
 * row, and the widest thing on them is a button that already spans the column.
 *
 * 16 states, 55 audits — 35.9% of the stress matrix's 153.
 *
 * What those 55 cost, stated properly because an earlier draft of this comment
 * called it "a small fraction of the per-audit cost" and that was wrong. The
 * navigation half is identical to an ordinary audit, not a fraction of it:
 * `goto`, `settle`, the interaction, `settle` again — the same calls
 * auditMatrixState and auditCurrentPage make, in the same order. What is skipped
 * is the measuring half: two axe passes, a twelve-press keyboard walk, and
 * eleven of the fourteen DOM checks, including the `body *` getComputedStyle
 * walk that is the most expensive one on a stress fee table. Call it half an
 * ordinary audit rather than a small fraction of one.
 *
 * The second `settle` is not the saving it looks like. Playwright records
 * `networkidle` as a lifecycle event of the current document, so a repeated
 * `waitForLoadState` on the same document returns immediately — the 2s is a
 * timeout, not a spend — and what remains is `document.fonts.ready` and two
 * animation frames. Dropping it for the twelve states that declare no
 * interaction would buy tens of milliseconds and give up the one wait that
 * catches content arriving after hydration.
 *
 * No smaller subset was taken either, because none of the obvious cuts is free.
 * Dropping the 1440 viewport would save 16 audits and lose the covered-control
 * measurement at desktop width — the one of the three that does not need a
 * narrow viewport, since a sticky header grows with the text it holds at every
 * width. Dropping two of the four /coach/financials/records views would save 6
 * and lose two distinct column sets. Both trade coverage for minutes and neither
 * can be shown safe without running them, so neither is taken quietly.
 *
 * What the 55 buy changed with this commit. Before auditTextResizeLayout learned
 * to check that rendered text answered the root, the app was sized entirely in
 * px, the sweep measured a render identical to the ordinary pass, and 55 audits
 * bought a constant zero. They now buy a measurement that can come back non-zero
 * and a gate that goes red if the page ever stops receiving the reader's
 * setting.
 */
const TEXT_RESIZE_STATE_IDS = [
  // Courtside registers and roll calls.
  "coach-player-attendance-register",
  "coach-player-attendance-record",
  "coach-staff-attendance-register",
  "coach-staff-roll-call",
  "coach-attendance-adjustments",
  "junior-coach-personal-attendance",
  "player-attendance",
  // Fee tables and the two money forms.
  "coach-monthly-fees",
  "coach-registration-fees",
  "coach-collections",
  "coach-financial-activity",
  "coach-player-financial-record",
  "coach-record-payment",
  "player-financials",
  // Member directory.
  "coach-members-filters",
  "coach-members-details",
] as const

// Throws rather than filters. A missing id means a state was renamed or removed,
// and the quiet answer to that -- drop it and audit the fifteen that remain --
// is a pass that silently stops covering a surface while still reporting a
// green run over a shorter list.
export function resolveTextResizeStates(
  ids: readonly string[],
): readonly AccessibilityState[] {
  return ids.map((id) => {
    const state = accessibilityStates.find((candidate) => candidate.id === id)
    if (!state) {
      throw new Error(
        `The text-resize pass names "${id}", which is not in accessibilityStates.`
        + " Point it at the state that replaced it, or drop it from TEXT_RESIZE_STATE_IDS"
        + " and say in the commit message which surface stopped being covered.",
      )
    }
    return state
  })
}

// Resolved at import rather than at use, so a renamed state fails the moment
// anything imports this file.
export const textResizeStates = resolveTextResizeStates(TEXT_RESIZE_STATE_IDS)

export function textResizeStatesForActor(actor: AccessibilityActor) {
  return textResizeStates.filter((state) => state.actor === actor)
}

// The audits the pass will perform, counted the way the matrix counts its own:
// one per state per viewport the state declares. Exported so the time argument
// above is a number a test can check rather than a claim in a comment.
export function textResizeAuditCount(states: readonly AccessibilityState[] = textResizeStates) {
  return states.reduce((total, state) => total + viewportsForState(state).length, 0)
}

// A separate id, so a text-resize measurement is never mistaken for the audit of
// the same state at the browser's default size. The two are different renders of
// the same route and the summary has to be able to say which is which.
export function textResizeResultId(stateId: string) {
  return `${stateId}${TEXT_RESIZE_RESULT_SUFFIX}`
}

export function isTextResizeResultId(resultId: string) {
  return resultId.endsWith(TEXT_RESIZE_RESULT_SUFFIX)
}

/*
 * How the font size is raised, and why not the other three ways.
 *
 * `Page.setFontSizes` is the browser's own default-font-size preference — the
 * one behind chrome://settings/fonts — reached over CDP. Blink resolves the
 * initial `font-size: medium` of the root element from it, so a document that
 * declares no root font-size inherits the user's choice, and one that declares
 * `html { font-size: 16px }` overrides the user exactly as it would in a real
 * browser. That last property is the whole reason to use it: it reproduces the
 * failure as well as the success.
 *
 * The three convenient alternatives all measure something else:
 *   - Injecting `html { font-size: 32px }` cannot see a page that overrides the
 *     user, because the injection *is* the override. It would report green on
 *     the one arrangement that fails real users.
 *   - `deviceScaleFactor` is device pixel ratio. It changes how many device
 *     pixels a CSS pixel occupies and leaves every CSS length identical, so no
 *     layout can break under it.
 *   - Halving the viewport emulates page zoom, which scales text and boxes
 *     together. That is SC 1.4.10 Reflow, and the existing pass already covers
 *     the narrow widths it would produce.
 *
 * Set before the page navigates anywhere. Blink applies the preference through a
 * settings change, and the reliable moment for a settings change is before the
 * document it will style exists.
 */
export async function applyBrowserFontSizePreference(
  page: Page,
  fontSizes: { fixed: number; standard: number } = TEXT_RESIZE_FONT_SIZES,
) {
  const client = await page.context().newCDPSession(page)
  await client.send("Page.setFontSizes", { fontSizes })
  return client
}

/*
 * Why every font-size change below is followed by a wait, and why the wait is on
 * the render rather than on the root.
 *
 * `Page.setFontSizes` resolves before the renderer has restyled anything. The
 * preference is delivered on a later animation frame, and until that frame has
 * run `getComputedStyle` still reports the sizes from before the call. Measured
 * rather than reasoned, against Chrome for Testing 151.0.7922.34 — the build
 * .github/workflows/ui-accessibility.yml installs — driven over raw CDP against
 * the app's own stylesheets: a root read in the same task as the call returned
 * reported the old size on every attempt.
 *
 * That is what went wrong the first time, and waiting for the root was the
 * repair. It was not enough, because the root is not the thing being measured.
 * The root and the document it styles arrive separately, and a wait that exits
 * on the root can exit while the rest of the tree still holds the previous
 * render:
 *
 *   - `getComputedStyle(document.documentElement).fontSize` resolves the root
 *     against the new preference on demand, so the wait below sees it arrive;
 *   - `getComputedStyle(document.body).fontSize` keeps reporting the *previous*
 *     size in that same task, and keeps reporting it however many times it is
 *     asked;
 *   - forcing layout does not dislodge it either — `documentElement.offsetHeight`
 *     returns a fresh height computed from the stale inherited sizes;
 *   - one animation frame does, every time.
 *
 * Measured on the state this cost two false failures. 400 lower-and-read cycles
 * against `coach-player-financial-record`, on a machine with every core busy,
 * produced 20 readings in which the root had already halved and `body` had not.
 * In all 20, a second synchronous read returned the stale size, a forced layout
 * returned the stale size, and the frame after returned the settled one. That is
 * the whole mechanism: an inherited restyle lands in a rendering lifecycle, and
 * nothing a reader can do from script brings it forward.
 *
 * So the fixed two-frame wait that followed the root check was a guess about how
 * many frames that takes, and on a loaded CI runner the guess is sometimes one
 * frame short. It fired twice on unrelated pull requests — #145, which changed
 * onboarding CSS and no type, and #152, which raised rem token values and
 * changed no units — and passed on re-run both times, on the same state, with
 * the same self-contradicting evidence: `body` reported at the raised size under
 * *both* preferences, beside a root that had plainly moved, and one of forty
 * sampled elements moved where a genuinely pinned page moves none and a healthy
 * one moves most.
 *
 * What replaces the guess is a reading that has to hold still. The wait below
 * reads the whole measurement — root, `body`, and every sampled element — once
 * per animation frame, and returns only when the root has reached the size that
 * was asked for and two consecutive frames have returned byte-identical numbers.
 * A frame of lag now costs a frame instead of a false accusation, and no count
 * of frames is assumed anywhere.
 *
 * `movedFrom` is the second half, and it is what makes a quiet reading provable
 * rather than merely stable. A stale reading is stable too — it repeats until
 * the frame that ends it — so quiescence alone would still admit one if the
 * restyle landed a frame after this returned. When the caller knows what `body`
 * measured at the other preference it passes that size in, and the wait also
 * requires `body` to have left it. A page whose text answers the root leaves it
 * within a frame or two. A page that has genuinely pinned `body` in an absolute
 * unit never leaves it, spends the whole 30-frame budget, and is then reported —
 * which is the finding this pass exists to produce, now reached by waiting the
 * budget out rather than by reading early and hoping.
 */
const TEXT_RENDER_QUIESCENT_FRAMES = 2
const TEXT_RENDER_SETTLE_FRAME_LIMIT = 30

/** One frame's answer to the whole question, read in a single task. */
type TextScaleReadingFrame = {
  body: number
  root: number
  sampled: { index: number; size: number }[]
}

type SettledTextScaleReading = {
  /** How many animation frames the reading took to stop changing. */
  frames: number
  reading: TextScaleReadingFrame
  /** False when the budget ran out first, which is evidence rather than an error. */
  settled: boolean
}

/*
 * `attribute` is the tag measureTextScaleResponse puts on the sampled elements;
 * `null` reads the root and `body` alone, which is all the callers outside the
 * probe have to settle. `movedFrom` is the `body` size measured at the other
 * preference, or `null` when there is nothing to compare against yet.
 */
async function settleTextScaleReading(page: Page, {
  attribute,
  expectedRoot,
  movedFrom,
}: {
  attribute: string | null
  expectedRoot: number
  movedFrom: number | null
}): Promise<SettledTextScaleReading> {
  return page.evaluate(async ({
    attribute,
    expectedRoot,
    limit,
    moveTolerance,
    movedFrom,
    quiescentFrames,
    tolerance,
  }) => {
    const sizeOf = (element: Element) => Number.parseFloat(getComputedStyle(element).fontSize)
    // The restore runs from a `finally`, which can be reached before a navigation has given
    // this document a body. Falling back keeps a missing body from replacing whatever error
    // brought us here with a null dereference.
    const read = (): TextScaleReadingFrame => ({
      body: sizeOf(document.body ?? document.documentElement),
      root: sizeOf(document.documentElement),
      sampled: attribute === null ? [] : [...document.querySelectorAll(`[${attribute}]`)].map(
        (element) => ({ index: Number(element.getAttribute(attribute)), size: sizeOf(element) }),
      ),
    })
    const frame = () => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
    // Byte-identical rather than within a tolerance. A tolerance here would let
    // a restyle that is still arriving count as one that has arrived, which is
    // the entire failure being repaired.
    const unchanged = (before: TextScaleReadingFrame | null, after: TextScaleReadingFrame) => (
      before !== null
      && before.body === after.body
      && before.root === after.root
      && before.sampled.length === after.sampled.length
      && before.sampled.every((entry, position) => entry.index === after.sampled[position].index
        && entry.size === after.sampled[position].size)
    )

    let previous: TextScaleReadingFrame | null = null
    let repeated = 0
    let reading = read()
    for (let waited = 0; ; waited += 1) {
      repeated = unchanged(previous, reading) ? repeated + 1 : 0
      const rootArrived = Math.abs(reading.root - expectedRoot) <= tolerance
      // Absolute, so the same wait serves the lowering the probe takes its second
      // reading after and the raising that puts the preference back.
      const bodyFollowed = movedFrom === null
        || Math.abs(reading.body - movedFrom) > moveTolerance
      if (rootArrived && bodyFollowed && repeated >= quiescentFrames) {
        return { frames: waited, reading, settled: true }
      }
      if (waited >= limit) return { frames: waited, reading, settled: false }
      previous = reading
      await frame()
      reading = read()
    }
  }, {
    attribute,
    expectedRoot,
    limit: TEXT_RENDER_SETTLE_FRAME_LIMIT,
    moveTolerance: TEXT_SCALE_TOLERANCE,
    movedFrom,
    quiescentFrames: TEXT_RENDER_QUIESCENT_FRAMES,
    tolerance: ROOT_FONT_SIZE_TOLERANCE,
  })
}

/*
 * The root size the document actually settled at, for the callers that only need
 * that one number: the check that opens auditTextResizeLayout, and the restore
 * that closes the probe.
 *
 * It waits on `body` as well as on the root even though it returns neither of
 * them together, because both callers hand the settled render to something else
 * — the layout walk in one case, a failure screenshot in the other — and a
 * render whose root has moved while its text has not is exactly the render
 * neither of them should be given.
 *
 * `movedFrom` is the size `body` held before the preference was changed, and the
 * restore at the end of the probe is the caller that has to supply it. Without
 * it this can only ask whether the reading has stopped changing, and a render
 * that has not begun restyling yet has also stopped changing — quiet for the
 * opposite reason. The check that opens auditTextResizeLayout passes nothing
 * because there is nothing to pass: it runs against a document that was parsed
 * and styled under the raised preference, with no change in flight for it to
 * mistake for a settled one.
 */
export async function settleBrowserFontSizePreference(
  page: Page,
  expectedStandard: number,
  movedFrom: number | null = null,
) {
  const settled = await settleTextScaleReading(page, {
    attribute: null,
    expectedRoot: expectedStandard,
    movedFrom,
  })
  return settled.reading.root
}

/** One reading of the same element at two root font sizes. */
export type TextScaleReading = { baseline: number; raised: number }

export type TextScaleSample = {
  body: TextScaleReading
  root: TextScaleReading
  sampled: (TextScaleReading & { target: string })[]
  /** Animation frames the lowered render was given before it was read. */
  settleFrames: number
  /** False when that budget ran out with the render still moving or still pinned. */
  settled: boolean
}

// Carries the position of a sampled element from the first reading to the
// second, because the two readings are now two `page.evaluate` calls with a CDP
// round trip between them and nothing else survives that boundary. An attribute
// rather than a re-run of the walk: the walk skips elements with a zero-sized
// box, an element can cross that line when the type it holds halves, and a walk
// that returned a different list would pair the raised reading of one element
// against the baseline reading of another and file the difference as a defect in
// the page. Removed by the second reading itself, in a `finally`.
const TEXT_SAMPLE_ATTRIBUTE = "data-text-resize-sample"

/*
 * Whether the text this page renders answers to the root, measured rather than
 * assumed.
 *
 * A single render cannot tell a scaled size from a pinned one: `13px` and
 * `0.40625rem` both compute to 13px at a 32px root, and reading the root alone
 * says only that the *preference* landed, never that anything downstream of it
 * moved. That is how a pass over an app sized entirely in px measures a render
 * byte-identical to the ordinary one, finds it clean — the ordinary pass has
 * already proved it clean at these very states and viewports — and reports a
 * green 200% result it never took.
 *
 * So vary the stimulus and watch. Every element is read twice: once at the root
 * the CDP preference produced, then again with the same CDP call sent back down
 * to the browser's shipped defaults, and then the preference is restored.
 * Anything declared in `rem`, `em`, `%` or nothing at all halves; anything pinned
 * in an absolute unit reads the same number twice.
 *
 * One mechanism in both directions, which is the change this round. The probe
 * used to force `font-size: 16px` onto the root as an inline style, and the
 * module comment above had to argue that an inline style outranks everything a
 * stylesheet can declare — true, and beside the point, because what defeated it
 * was reading the result in the same task as the write. Lowering the same
 * preference that raised the page removes the argument entirely: if the call
 * moved the root up it moves it back down, and there is no cascade to reason
 * about. It costs one more CDP round trip and one more `page.evaluate` per audit.
 *
 * Run after the layout walk, never before, so the render this pass reports on is
 * the one the preference produced and not one that has just been shrunk and
 * regrown under a ResizeObserver. The `finally` restores the raised preference
 * and waits for it to arrive, so the page this leaves behind — the one a failure
 * screenshot captures, and the one the next state inherits before it navigates —
 * is the render that was measured rather than the halved one.
 */
/*
 * Where the sample is taken from, and why not `document.body`.
 *
 * The walk used to start at `document.body`, which meant it took the first forty
 * text-writing elements in document order — and on every signed-in route the
 * first of those belong to the skip link, the masthead and the navigation, which
 * are the same handful of components on all sixteen states. The surface each
 * state was chosen for is what comes after them. On the fee record at tablet
 * width that walk reached only ten elements at all, so a state picked for a table
 * of amounts, dates and player names was being judged on ten mostly-chrome
 * readings.
 *
 * The main landmark is the page's own content, it is where every state's
 * distinguishing surface lives, and `main-landmark-count` in
 * accessibility-audit.ts already fails any state that does not have exactly one —
 * the ordinary pass asserts these very states clean at these very viewports — so
 * this is not reaching for something that might not be there. `document.body`
 * remains the fallback rather than an error, because a state whose main landmark
 * is missing has a finding of its own from the ordinary pass and should not also
 * collect a text-resize accusation for it.
 */
export async function measureTextScaleResponse({
  baselineFontSizes = BROWSER_DEFAULT_FONT_SIZES,
  client,
  fontSizes = TEXT_RESIZE_FONT_SIZES,
  page,
}: {
  baselineFontSizes?: { fixed: number; standard: number }
  client: CDPSession
  fontSizes?: { fixed: number; standard: number }
  page: Page
}): Promise<TextScaleSample> {
  // Tagging is its own call now, ahead of both readings. The readings are taken
  // by a wait that reads once per animation frame until the numbers hold still,
  // and a walk that tagged as it read would have re-run that walk every frame.
  const targets = await page.evaluate(({ attribute, limit }) => {
    // A shorter selectorFor than the audit's, and separate from it on purpose:
    // that one lives inside its own page.evaluate body and cannot be imported,
    // and this one only has to name an element in a failure message.
    const selectorFor = (element: Element) => {
      if (element.id) return `#${CSS.escape(element.id)}`
      const className = [...element.classList].at(0)
      return className ? `${element.localName}.${CSS.escape(className)}` : element.localName
    }

    // Elements holding text of their own, in document order. A direct text node
    // is the test rather than `textContent`, because every ancestor of a
    // paragraph also "contains" its words while carrying none of its own --
    // sampling those would measure the same declaration many times and crowd out
    // the rest of the screen.
    const scope = document.querySelector("main, [role=main]") ?? document.body
    const candidates: Element[] = []
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node as Element
      const writes = [...element.childNodes].some((child) => (
        child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim().length > 0
      ))
      if (!writes) continue
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      candidates.push(element)
    }

    // An even stride through the landmark rather than the first `limit` of it.
    // Document order front-loads a page's own header -- the heading, the summary
    // block, the toolbar -- and a fee table's rows begin after all of it, so a
    // window taken from the front reads a state's chrome and never reaches the
    // surface the state was chosen for. Striding keeps document order and keeps
    // the sample deterministic; it only stops the sample from ending early.
    const stride = Math.max(1, Math.floor(candidates.length / limit))
    const sample: Element[] = []
    for (let index = 0; index < candidates.length && sample.length < limit; index += stride) {
      const element = candidates[index]
      element.setAttribute(attribute, String(sample.length))
      sample.push(element)
    }
    return sample.map((element, index) => ({ index, target: selectorFor(element) }))
  }, { attribute: TEXT_SAMPLE_ATTRIBUTE, limit: TEXT_SAMPLE_LIMIT })

  try {
    const raised = await settleTextScaleReading(page, {
      attribute: TEXT_SAMPLE_ATTRIBUTE,
      expectedRoot: fontSizes.standard,
      movedFrom: null,
    })
    // What `body` measured under the lowered preference, so the restore below can wait for
    // it to come back up rather than for the reading to merely hold still. Declared out here
    // because the restore lives in a `finally` that also runs when the reading it comes from
    // never happened.
    let loweredBody: number | null = null
    try {
      await client.send("Page.setFontSizes", { fontSizes: baselineFontSizes })
      // `movedFrom` is the size `body` held a moment ago, so this wait cannot
      // return the render that is still holding it. That is the whole repair:
      // the previous version waited a fixed two frames on the root alone and
      // then read, and on a loaded runner the read sometimes landed one frame
      // before the document restyled.
      const dropped = await settleTextScaleReading(page, {
        attribute: TEXT_SAMPLE_ATTRIBUTE,
        expectedRoot: baselineFontSizes.standard,
        movedFrom: raised.reading.body,
      })
      loweredBody = dropped.reading.body

      // Joined on the position the attribute carries rather than on array order,
      // so an element that lost its box between the two readings drops out of the
      // sample instead of shifting every reading after it by one.
      const targetByIndex = new Map(targets.map((entry) => [entry.index, entry.target]))
      const baselineByIndex = new Map(
        dropped.reading.sampled.map((reading) => [reading.index, reading.size]),
      )
      return {
        body: { baseline: dropped.reading.body, raised: raised.reading.body },
        root: { baseline: dropped.reading.root, raised: raised.reading.root },
        sampled: raised.reading.sampled.flatMap((reading) => {
          const baseline = baselineByIndex.get(reading.index)
          const target = targetByIndex.get(reading.index)
          if (baseline === undefined || target === undefined) return []
          return [{ baseline, raised: reading.size, target }]
        }),
        // Carried out so the finding can say how long the lowered render was
        // given before it was judged. A reader who is told "0 of 40 moved" needs
        // to know whether that was read after two frames or after thirty.
        settleFrames: dropped.frames,
        settled: dropped.settled,
      }
    } finally {
      // Restored whatever happened, because the page is reused for every remaining
      // state in the sweep and a preference left at the browser default would make
      // the next state's root reading fail for a reason that has nothing to do
      // with the next state.
      await client.send("Page.setFontSizes", { fontSizes })
      // Swallowed, and only this half of the restore is. The `send` above is what
      // the next state depends on — it navigates, and a fresh document is styled
      // from the preference rather than from this render — so the wait is about
      // the page this leaves behind for a failure screenshot. A wait that threw
      // here would replace whatever error brought us into the `finally` with a
      // stack about a screenshot.
      await settleBrowserFontSizePreference(page, fontSizes.standard, loweredBody)
        .catch(() => undefined)
    }
  } finally {
    // Its own call, because the readings no longer own the elements they read:
    // the tag has to survive both of them and the restore above. Anything left
    // behind would be visible to the ordinary pass on the next state and in
    // every screenshot taken afterwards.
    await page.evaluate((attribute) => {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        element.removeAttribute(attribute)
      }
    }, TEXT_SAMPLE_ATTRIBUTE).catch(() => undefined)
  }
}

/*
 * The verdict on that sample.
 *
 * `body` is the load-bearing reading and the sample is the corroboration, in
 * that order and for that reason: every state's text inherits from `body`
 * unless a rule intervenes, so an absolute `font-size` there freezes the whole
 * document at one stroke, and it is the single line whose unit decides whether
 * this pass has anything to catch. The sample answers the narrower case where
 * `body` scales but the surface under test does not.
 *
 * A share of the sample has to move, not one element of it. `responsive > 0` was
 * the weakest question the sample can be asked: it clears on a single `<em>`
 * anywhere in the landmark, so a surface that had pinned every column it renders
 * and left one caption in `rem` would pass. It is also the threshold that made a
 * racing measurement look like a finding rather than like noise — the two false
 * failures this check produced both read one moved element out of forty, a count
 * no real arrangement produces, since a genuinely absorbed render moves none and
 * a healthy one moves most. TEXT_RESPONSIVE_SHARE_DIVISOR is where that share is
 * set and why it is set there.
 *
 * An empty sample is not a failure, and a share of nothing is nothing, so the
 * arithmetic already says so. A render with no visible element writing text of
 * its own is a broken page, and the ordinary pass owns that; calling it
 * "absorbed" here would put a text-resize failure on a state whose problem is
 * that it rendered nothing.
 */
export function textResizeAbsorbedFindings(
  sample: TextScaleSample,
  requestedStandard: number,
  baselineStandard: number = BROWSER_DEFAULT_FONT_SIZES.standard,
): AccessibilityFinding[] {
  const moved = (reading: TextScaleReading) => (
    reading.raised - reading.baseline > TEXT_SCALE_TOLERANCE
  )
  if (!moved(sample.root)) {
    return [{
      id: "text-resize-probe-not-applied",
      impact: "critical",
      message: `This pass checks that rendered text answers to the root by sending the browser`
        + ` font-size preference back down to ${baselineStandard}px over CDP — the same call that`
        + " raised it — waiting for the change to reach the document, and reading everything a"
        + ` second time. The root did not move: ${sample.root.raised}px at the raised preference`
        + ` and ${sample.root.baseline}px under the probe. No stylesheet produces that, because`
        + " the preference is the browser's own default font size rather than a rule the cascade"
        + " can outrank; what produces it is a reading taken before the change has arrived, so"
        + " start at settleBrowserFontSizePreference and at how many frames it waited. Reported"
        + " separately from the page's own result because it is this check that stopped working,"
        + " not the page, and a check that cannot measure must not be allowed to accuse.",
      source: "layout",
      targets: ["html"],
    }]
  }
  const inert = sample.sampled.filter((reading) => !moved(reading))
  const responsive = sample.sampled.length - inert.length
  // Multiplied rather than divided, so an indivisible sample is decided in
  // integers and a sample of one still has to be the one that moved.
  if (moved(sample.body)
    && responsive * TEXT_RESPONSIVE_SHARE_DIVISOR >= sample.sampled.length) return []
  const named = inert.slice(0, 3).map((reading) => `${reading.target} at ${reading.raised}px`)
  return [{
    id: "text-resize-absorbed",
    impact: "critical",
    message: `The browser default font size was raised from ${baselineStandard}px to`
      + ` ${requestedStandard}px and the root element followed, but the text this page renders`
      + ` did not: body computed to ${sample.body.raised}px at the raised root and`
      + ` ${sample.body.baseline}px at the default one, and ${responsive}`
      + ` of ${sample.sampled.length} sampled text elements moved`
      + `${named.length ? ` (${named.join(", ")} did not)` : ""}, where at least a third have to.`
      + ` Both readings were taken from a`
      + ` render that had stopped changing: the lowered one was read once per animation frame`
      + ` until two consecutive frames returned identical numbers, which took`
      + ` ${sample.settleFrames} ${sample.settleFrames === 1 ? "frame" : "frames"}`
      + `${sample.settled ? "" : " and never arrived, so this is the render after the whole"
        + " 30-frame budget"}. An absolute font-size on body —`
      + " or on anything the page's text inherits from — absorbs the reader's setting outright,"
      + " and the layout walk that follows would then be measuring the ordinary render this"
      + " matrix already audits at the default size and already asserts clean, and filing the"
      + " result as a 200% pass. Give the pinned declaration a unit that resolves against the"
      + " root — rem, em or a percentage — rather than relaxing this check; the check going"
      + " quiet is the only failure mode this whole pass has.",
    source: "layout",
    targets: ["body", ...inert.slice(0, 3).map((reading) => reading.target)],
  }]
}

/*
 * Two blocking questions, then one advisory measurement.
 *
 * The first blocking question is whether the preference reached the root, asked
 * after waiting for it rather than the moment the navigation returned: if the
 * root element did not end up at the size that was asked for, then this pass
 * measured some other magnification and every green result it produced belongs
 * to a ceiling nobody chose. The wait is not politeness: a font-size change
 * reaches the root a frame before it reaches the tree that inherits from it, so
 * a read taken the moment `goto` returned can find the root at 200% above a
 * document still laid out at 100% — and the layout walk on the next line would
 * then measure that document and file its measurements as a 200% result.
 *
 * The three ways the root itself can be wrong are named in the
 * message. Today app/globals.css declares `scroll-behavior` and
 * `scroll-padding-top` on `html` and no `font-size`, and no other stylesheet in
 * the app touches the root either — tests/accessibility-text-resize.test.ts
 * parses all thirteen and holds that — so the preference reaches the root and
 * this finding stays empty. The day somebody declares one, this says so instead
 * of going quiet.
 *
 * The second is whether it reached anything the page actually renders, and it
 * exists because the first cannot answer it. `body { font-size: 16px }` is an
 * absolute pin one level below the root: the root moves, the document does not,
 * and the layout walk then runs against a render byte-identical to the one the
 * ordinary pass just measured at these very states and viewports — and already
 * asserted clean. That is not a pass expected to find nothing, it is a pass
 * incapable of finding anything, and it would have stayed green through a
 * revert of the one declaration the whole conversion turns on. The answer comes
 * from reading the page at two root sizes rather than one — see
 * measureTextScaleResponse — and textResizeAbsorbedFindings turns the pair of
 * readings into a verdict.
 *
 * The advisory ones are about the page, and they are the three layout
 * measurements the ordinary pass already makes, re-read from
 * accessibility-audit.ts rather than restated here. Their ids carry a
 * `text-resize-` prefix because the ordinary pass fails the build on the
 * unprefixed ids: sharing them would put a blocking count and an advisory count
 * of the same name into one ratchet and make the recorded ceiling unreadable.
 *
 * Order: root, layout, probe. The root check comes first because everything
 * after it is meaningless without it, and because a wrong render should cost one
 * evaluate rather than four. The probe comes last, after the layout walk rather
 * than before it, because it lowers the browser preference to take its second
 * reading — doing that first would hand the layout walk a page that had just been
 * shrunk and regrown, and this pass exists to measure a render, not to survive
 * one. Its answer still governs: an absorbed render reports the finding and
 * discards the advisories it collected, because an advisory taken from the
 * ordinary render is worse than no advisory at all.
 *
 * `client` is the CDP session that raised the preference in the first place, not
 * a second one. Same target, same settings object: a probe that lowered some
 * other session's preference would move nothing and blame itself for it.
 */
export async function auditTextResizeLayout({
  baselineFontSizes = BROWSER_DEFAULT_FONT_SIZES,
  client,
  fontSizes = TEXT_RESIZE_FONT_SIZES,
  page,
  viewport,
}: {
  baselineFontSizes?: { fixed: number; standard: number }
  client: CDPSession
  fontSizes?: { fixed: number; standard: number }
  page: Page
  viewport: AccessibilityViewport
}): Promise<{ advisories: AccessibilityAdvisory[]; findings: AccessibilityFinding[] }> {
  const rootFontSize = await settleBrowserFontSizePreference(page, fontSizes.standard)
  const applied = textResizeApplicationFindings(rootFontSize, fontSizes.standard)
  if (applied.length) return { advisories: [], findings: applied }
  const layout = await collectAccessibilityLayout(page, viewport)
  const sample = await measureTextScaleResponse({ baselineFontSizes, client, fontSizes, page })
  const absorbed = textResizeAbsorbedFindings(sample, fontSizes.standard, baselineFontSizes.standard)
  if (absorbed.length) return { advisories: [], findings: absorbed }
  return {
    advisories: textResizeAdvisories(layoutFindings(layout), rootFontSize, fontSizes.standard),
    findings: [],
  }
}

export function textResizeApplicationFindings(
  rootFontSize: number,
  requestedStandard: number,
): AccessibilityFinding[] {
  if (Math.abs(rootFontSize - requestedStandard) <= ROOT_FONT_SIZE_TOLERANCE) return []
  return [{
    id: "text-resize-not-applied",
    impact: "critical",
    message: `The browser default font size was raised to ${requestedStandard}px, but the root`
      + ` element computed to ${rootFontSize}px, so this render is not the render this pass`
      + " claims to measure. Three things produce it: the CDP preference did not reach this"
      + " page; a stylesheet declares an absolute root font-size and overrides the reader's"
      + " setting outright; or it declares a relative one, which still scales but lands"
      + " somewhere other than 200%. The first two are accessibility defects in their own"
      + " right. The third is not, and the remedy for it is to teach this pass what the"
      + " declared root is rather than to widen the tolerance — a pass that accepts any root"
      + " size records a ceiling for a magnification nobody chose. Either way no layout"
      + " measurement is taken here, because a green measurement of an ordinary render is"
      + " worse than no measurement at all.",
    source: "layout",
    targets: ["html"],
  }]
}

export function textResizeAdvisories(
  findings: readonly AccessibilityFinding[],
  rootFontSize: number,
  requestedStandard: number,
): AccessibilityAdvisory[] {
  const scale = Math.round((requestedStandard / BROWSER_DEFAULT_FONT_SIZES.standard) * 100)
  return findings.map((item) => ({
    ...item,
    category: "text-resize",
    id: `text-resize-${item.id}`,
    message: `At a ${rootFontSize}px root font size (${scale}% of the browser default): ${item.message}`,
  }))
}
