import type { Page } from "@playwright/test"

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

// How many rendered text elements the responsiveness probe reads. Bounded
// because the walk is the cost: the full `body *` walk is the expensive one in
// accessibility-audit.ts and on the stress fee table it is thousands of
// elements. Forty is enough that a page whose text is inert cannot hide behind
// a sample of one, and it is reached within the first screenful of any state
// this pass covers.
const TEXT_SAMPLE_LIMIT = 40

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

export async function readRootFontSize(page: Page) {
  return page.evaluate(() => (
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  ))
}

/** One reading of the same element at two root font sizes. */
export type TextScaleReading = { baseline: number; raised: number }

export type TextScaleSample = {
  body: TextScaleReading
  root: TextScaleReading
  sampled: (TextScaleReading & { target: string })[]
}

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
 * the CDP preference produced, then again with `font-size: 16px` forced onto the
 * root as an inline style, and then the inline style is removed. Anything
 * declared in `rem`, `em`, `%` or nothing at all halves; anything pinned in an
 * absolute unit reads the same number twice.
 *
 * The inline style is a probe, not the magnification. The distinction matters
 * because the module comment above rejects injection as the *mechanism*: an
 * injected root font-size cannot see a stylesheet that overrides the reader,
 * because the injection is the override. Here the override is the point — it is
 * asking "what would this element be at the default root", and by the time it
 * runs, textResizeApplicationFindings has already proved the CDP preference
 * reached the root, which is the fact injection would have hidden. The probe
 * loses to `html { font-size: X !important }`, and that case is caught by the
 * root reading below rather than blamed on the page.
 *
 * Run after the layout walk, never before, so the render this pass reports on is
 * the one the preference produced and not one that has just been shrunk and
 * regrown under a ResizeObserver.
 */
export async function measureTextScaleResponse(
  page: Page,
  baselineStandard: number = BROWSER_DEFAULT_FONT_SIZES.standard,
): Promise<TextScaleSample> {
  return page.evaluate(({ baselineStandard: baseline, limit }) => {
    // A shorter selectorFor than the audit's, and separate from it on purpose:
    // that one lives inside its own page.evaluate body and cannot be imported,
    // and this one only has to name an element in a failure message.
    const selectorFor = (element: Element) => {
      if (element.id) return `#${CSS.escape(element.id)}`
      const className = [...element.classList].at(0)
      return className ? `${element.localName}.${CSS.escape(className)}` : element.localName
    }

    // Elements holding text of their own, in document order, up to the limit.
    // A direct text node is the test rather than `textContent`, because every
    // ancestor of a paragraph also "contains" its words while carrying none of
    // its own -- sampling those would measure the same declaration many times
    // and crowd out the rest of the screen.
    const sample: Element[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
    while (sample.length < limit) {
      const node = walker.nextNode()
      if (!node) break
      const element = node as Element
      const writes = [...element.childNodes].some((child) => (
        child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim().length > 0
      ))
      if (!writes) continue
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      sample.push(element)
    }

    const sizeOf = (element: Element) => Number.parseFloat(getComputedStyle(element).fontSize)
    const readAll = () => ({
      body: sizeOf(document.body),
      root: sizeOf(document.documentElement),
      sampled: sample.map(sizeOf),
    })

    const raised = readAll()
    const inline = document.documentElement.style.fontSize
    try {
      document.documentElement.style.fontSize = `${baseline}px`
      const dropped = readAll()
      return {
        body: { baseline: dropped.body, raised: raised.body },
        root: { baseline: dropped.root, raised: raised.root },
        sampled: sample.map((element, index) => ({
          baseline: dropped.sampled[index],
          raised: raised.sampled[index],
          target: selectorFor(element),
        })),
      }
    } finally {
      // Restored whatever happened, because the page is reused for every
      // remaining state in the sweep and a leftover 16px root would make the
      // next state's root reading fail for a reason that has nothing to do with
      // the next state.
      if (inline) document.documentElement.style.fontSize = inline
      else document.documentElement.style.removeProperty("font-size")
    }
  }, { baselineStandard, limit: TEXT_SAMPLE_LIMIT })
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
 * An empty sample is not a failure. A render with no visible element writing
 * text of its own is a broken page, and the ordinary pass owns that; calling it
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
      message: `This pass checks that rendered text answers to the root by forcing the root back`
        + ` to ${baselineStandard}px as an inline style and reading everything a second time, and`
        + ` the root did not move: ${sample.root.raised}px at the browser preference and`
        + ` ${sample.root.baseline}px under the probe. An inline style loses to`
        + " `html { font-size: … !important }` and to nothing else, so that is what to look for."
        + " Reported separately from the page's own result because it is this check that stopped"
        + " working, not the page, and a check that cannot measure must not be allowed to"
        + " accuse.",
      source: "layout",
      targets: ["html"],
    }]
  }
  const inert = sample.sampled.filter((reading) => !moved(reading))
  const responsive = sample.sampled.length - inert.length
  if (moved(sample.body) && (responsive > 0 || sample.sampled.length === 0)) return []
  const named = inert.slice(0, 3).map((reading) => `${reading.target} at ${reading.raised}px`)
  return [{
    id: "text-resize-absorbed",
    impact: "critical",
    message: `The browser default font size was raised from ${baselineStandard}px to`
      + ` ${requestedStandard}px and the root element followed, but the text this page renders`
      + ` did not: body computed to ${sample.body.raised}px at the raised root and`
      + ` ${sample.body.baseline}px at the default one, and ${responsive}`
      + ` of ${sample.sampled.length} sampled text elements moved`
      + `${named.length ? ` (${named.join(", ")} did not)` : ""}. An absolute font-size on body —`
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
 * The first blocking question is whether the preference reached the root: if the
 * root element did not end up at the size that was asked for, then this pass
 * measured some other magnification and every green result it produced belongs
 * to a ceiling nobody chose. The three ways that happens are named in the
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
 * evaluate rather than three. The probe comes last, after the layout walk rather
 * than before it, because it moves the root to take its second reading — doing
 * that first would hand the layout walk a page that had just been shrunk and
 * regrown, and this pass exists to measure a render, not to survive one. Its
 * answer still governs: an absorbed render reports the finding and discards the
 * advisories it collected, because an advisory taken from the ordinary render is
 * worse than no advisory at all.
 */
export async function auditTextResizeLayout({
  baselineFontSizes = BROWSER_DEFAULT_FONT_SIZES,
  fontSizes = TEXT_RESIZE_FONT_SIZES,
  page,
  viewport,
}: {
  baselineFontSizes?: { fixed: number; standard: number }
  fontSizes?: { fixed: number; standard: number }
  page: Page
  viewport: AccessibilityViewport
}): Promise<{ advisories: AccessibilityAdvisory[]; findings: AccessibilityFinding[] }> {
  const rootFontSize = await readRootFontSize(page)
  const applied = textResizeApplicationFindings(rootFontSize, fontSizes.standard)
  if (applied.length) return { advisories: [], findings: applied }
  const layout = await collectAccessibilityLayout(page, viewport)
  const sample = await measureTextScaleResponse(page, baselineFontSizes.standard)
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
