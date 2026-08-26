import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import type { CDPSession, Page } from "@playwright/test"

import { describe, expect, it } from "vitest"

import {
  accessibilityAdvisoryIncreases,
  accessibilityAdvisoryRegressions,
  buildAccessibilitySummary,
  countAccessibilityAdvisories,
  layoutFindings,
  type AccessibilityAdvisory,
  type AccessibilityResult,
  type LayoutAudit,
} from "./e2e/support/accessibility-audit"
import {
  accessibilityStates,
  accessibilityViewports,
  statesForProfile,
  viewportsForState,
} from "./e2e/support/accessibility-matrix"
import {
  auditTextResizeLayout,
  BROWSER_DEFAULT_FONT_SIZES,
  isTextResizeResultId,
  resolveTextResizeStates,
  textResizeAbsorbedFindings,
  textResizeAdvisories,
  textResizeApplicationFindings,
  textResizeAuditCount,
  textResizeResultId,
  textResizeStates,
  textResizeStatesForActor,
  TEXT_RESIZE_FONT_SIZES,
  type TextScaleSample,
} from "./e2e/support/accessibility-text-resize"

const CLEAN_LAYOUT: LayoutAudit = {
  clippedControls: [],
  coveredControls: [],
  pageOverflow: null,
}

/** A sample in which everything answered to the root: the reader's setting reached the
 *  page, so halving the root halved the text. */
function responsiveSample(): TextScaleSample {
  return {
    body: { baseline: 16, raised: 32 },
    root: { baseline: 16, raised: 32 },
    sampled: [
      { baseline: 13, raised: 26, target: "td.coach-fee-amount" },
      { baseline: 11, raised: 22, target: "span.coach-fee-label" },
    ],
  }
}

// A page that answers the questions auditTextResizeLayout asks, in the order it asks them,
// and records which ones it was asked. The record is the assertion: each entry is one
// `evaluate`, so the list of names is a transcript of how far the walk got before it decided
// it was measuring the wrong render.
//
// Six entries, not three, because the probe is now two readings with a CDP round trip
// between them: it reads the page at the raised preference, sends the preference back down,
// waits for the change to arrive, reads again, and puts the preference back. `settle` is
// that wait, and it appears once per direction. The first entry is a wait too -- the root
// reading that opens the audit waits for the raised preference to have reached the document
// before it believes what the root says -- which is why it is named for the settled root
// rather than for a bare read.
function pageAnswering({
  layout = CLEAN_LAYOUT,
  rootFontSize,
  sample = responsiveSample(),
}: {
  layout?: LayoutAudit
  rootFontSize: number
  sample?: TextScaleSample
}) {
  const reading = (side: "baseline" | "raised") => ({
    body: sample.body[side],
    root: sample.root[side],
    sampled: sample.sampled.map((entry, index) => ({
      index,
      size: entry[side],
      target: entry.target,
    })),
  })
  const script = [
    { answer: () => rootFontSize as unknown, name: "settled-root-font-size" },
    { answer: () => layout as unknown, name: "layout" },
    { answer: () => reading("raised") as unknown, name: "text-scale" },
    { answer: () => BROWSER_DEFAULT_FONT_SIZES.standard as unknown, name: "settle" },
    { answer: () => reading("baseline") as unknown, name: "text-scale" },
    { answer: () => TEXT_RESIZE_FONT_SIZES.standard as unknown, name: "settle" },
  ]
  const calls: string[] = []
  const sends: { fixed: number; standard: number }[] = []
  const page = {
    evaluate: async () => {
      const step = script[calls.length]
      calls.push(step?.name ?? `unexpected-${calls.length}`)
      return step?.answer()
    },
  }
  const client = {
    send: async (method: string, params: { fontSizes: { fixed: number; standard: number } }) => {
      expect(method).toBe("Page.setFontSizes")
      sends.push(params.fontSizes)
    },
  }
  return { calls, client: client as unknown as CDPSession, page: page as unknown as Page, sends }
}

function textResizeResult(advisories: readonly AccessibilityAdvisory[]): AccessibilityResult {
  return {
    actor: "head-coach",
    advisories: [...advisories],
    description: "Monthly fee records at 32px browser text",
    findings: [],
    id: textResizeResultId("coach-monthly-fees"),
    profile: "stress",
    route: "/coach/financials/records?view=fees&mode=monthly&period=2026-08",
    title: "Fee records",
    url: "http://127.0.0.1/coach/financials/records",
    viewport: accessibilityViewports[0],
  }
}

describe("the size the text-resize pass renders at", () => {
  it("asks for exactly twice the browser's own shipped default", () => {
    // 200% of the default is the number SC 1.4.4 names, and the default is the
    // number Chromium ships. Neither half of that is free to drift alone.
    expect(BROWSER_DEFAULT_FONT_SIZES).toEqual({ fixed: 13, standard: 16 })
    expect(TEXT_RESIZE_FONT_SIZES.standard).toBe(BROWSER_DEFAULT_FONT_SIZES.standard * 2)
    expect(TEXT_RESIZE_FONT_SIZES.fixed).toBe(BROWSER_DEFAULT_FONT_SIZES.fixed * 2)
  })

  it("refuses to report a clean layout when the root never reached that size", () => {
    // The failure that would otherwise be invisible. A page that declares its own
    // root font-size overrides the reader's preference, and a CDP call that did
    // not land leaves the same trace: an ordinary render, measured, and found
    // fine. Both have to stop the run.
    expect(textResizeApplicationFindings(32, 32)).toEqual([])
    expect(textResizeApplicationFindings(32.4, 32)).toEqual([])
    const [unapplied] = textResizeApplicationFindings(16, 32)
    expect(unapplied.id).toBe("text-resize-not-applied")
    expect(unapplied.impact).toBe("critical")
    expect(unapplied.message).toContain("raised to 32px")
    expect(unapplied.message).toContain("computed to 16px")
    // Equality, not "did it move at all". `html { font-size: 62.5% }` scales with
    // the reader's setting and still lands at 20px here, which is a 125% render
    // being recorded against a ceiling labelled 200%. A ratchet that accepts any
    // magnification is a ratchet on nothing.
    expect(textResizeApplicationFindings(20, 32)).toHaveLength(1)
    expect(textResizeApplicationFindings(33, 32)).toHaveLength(1)
  })

  it("stops before it measures anything, rather than measuring the wrong render", async () => {
    // Ordering, not just reporting: if the layout walk ran anyway its results
    // would be written beside a critical finding and read as a clean 200% pass
    // the moment somebody triaged the finding away.
    const unapplied = pageAnswering({ rootFontSize: 16 })
    const audited = await auditTextResizeLayout({
      client: unapplied.client,
      page: unapplied.page,
      viewport: accessibilityViewports[0],
    })
    expect(audited.findings.map((item) => item.id)).toEqual(["text-resize-not-applied"])
    expect(audited.advisories).toEqual([])
    expect(unapplied.calls).toEqual(["settled-root-font-size"])
    // And it left the browser preference alone: a pass that has given up on this render
    // still owes the next state the size it was handed.
    expect(unapplied.sends).toEqual([])
  })
})

/*
 * The half of the guard that reads the page instead of the root.
 *
 * A root reading proves the reader's setting arrived. It cannot prove anything received it,
 * and the difference is not academic: `body { font-size: 16px }` is one line, it is what
 * app/globals.css declared before this campaign, and under it the root goes to 32px while
 * every word on screen stays exactly where it was. The layout walk then measures a render
 * byte-identical to the one the ordinary matrix pass took at the default size — a render
 * that pass has already asserted clean on these same states and viewports — and files it as
 * a green 200% result. That is not a gate that happens to find nothing. It is a gate that
 * cannot find anything, and it would have survived a revert of the one declaration the
 * whole px-to-rem conversion turns on.
 *
 * So the sample is read twice, at two root sizes, and these cases are the verdict on the
 * pair.
 */
describe("whether the page received the size the pass renders at", () => {
  const sample = (over: Partial<TextScaleSample>): TextScaleSample => ({
    ...responsiveSample(),
    ...over,
  })

  it("passes a page whose body and rendered text both followed the root", () => {
    expect(textResizeAbsorbedFindings(responsiveSample(), 32, 16)).toEqual([])
  })

  it("fails a page whose body absorbed the reader's setting", () => {
    // The exact shape of `body { font-size: 16px }` under a 32px preference: the root
    // doubled, the document did not.
    const [absorbed] = textResizeAbsorbedFindings(sample({
      body: { baseline: 16, raised: 16 },
      sampled: [
        { baseline: 13, raised: 13, target: "td.coach-fee-amount" },
        { baseline: 11, raised: 11, target: "span.coach-fee-label" },
      ],
    }), 32, 16)
    expect(absorbed.id).toBe("text-resize-absorbed")
    expect(absorbed.impact).toBe("critical")
    expect(absorbed.message).toContain("body computed to 16px at the raised root and 16px")
    expect(absorbed.message).toContain("0 of 2 sampled text elements moved")
    expect(absorbed.message).toContain("td.coach-fee-amount at 13px")
    expect(absorbed.targets).toEqual(["body", "td.coach-fee-amount", "span.coach-fee-label"])
  })

  it("fails a page whose body scaled while nothing it renders did", () => {
    // The narrower case, and the reason the sample exists at all rather than a body reading
    // on its own: `body` can be in rem while the surface under test sits inside a subtree
    // that pins its own type, and the layout walk would then be measuring that subtree
    // unchanged.
    const [absorbed] = textResizeAbsorbedFindings(sample({
      sampled: [{ baseline: 13, raised: 13, target: "td.coach-fee-amount" }],
    }), 32, 16)
    expect(absorbed.id).toBe("text-resize-absorbed")
    expect(absorbed.message).toContain("0 of 1 sampled text elements moved")
  })

  it("counts half a pixel as no movement at all", () => {
    // Same tolerance as the root reading, for the same reason: Blink rounds a computed
    // font-size onto a device-pixel grid, and text that genuinely doubled moves by whole
    // pixels — the smallest type in these sheets goes 10px to 20px. A guard that accepted
    // a 0.4px drift as "it scaled" would pass the very render it exists to reject.
    expect(textResizeAbsorbedFindings(sample({
      body: { baseline: 16, raised: 16.4 },
      sampled: [{ baseline: 13, raised: 13.4, target: "td.coach-fee-amount" }],
    }), 32, 16).map((item) => item.id)).toEqual(["text-resize-absorbed"])
  })

  it("does not call a render with no sampled text absorbed", () => {
    // A page that rendered no visible element writing text of its own is a broken page, and
    // the ordinary pass owns broken pages. Reporting it here would put a text-resize failure
    // on a state whose problem is that it rendered nothing.
    expect(textResizeAbsorbedFindings(sample({ sampled: [] }), 32, 16)).toEqual([])
  })

  it("blames the probe, not the page, when the probe could not move the root", () => {
    // The probe sends the browser font-size preference back down to 16px and waits for the
    // change to reach the document. If the root still reads 32px afterwards then every
    // element reads the same number twice and the page looks inert when it is not -- which
    // is what shipped last round, and what CI reported on all 55 audits -- so the one case
    // where this check cannot measure has to be the one case where it does not accuse.
    const [broken] = textResizeAbsorbedFindings(sample({
      body: { baseline: 32, raised: 32 },
      root: { baseline: 32, raised: 32 },
      sampled: [{ baseline: 26, raised: 26, target: "td.coach-fee-amount" }],
    }), 32, 16)
    expect(broken.id).toBe("text-resize-probe-not-applied")
    expect(broken.impact).toBe("critical")
    expect(broken.message).toContain("32px at the raised preference and 32px under the probe")
    expect(broken.message).toContain("settleBrowserFontSizePreference")
  })

  it("refuses to file a layout measurement taken from an absorbed render", async () => {
    // The whole point, end to end. The layout the walk collected here is not clean — it
    // overflows — and it is still thrown away, because an overflow on an inert render is an
    // overflow the ordinary pass already fails the build on at the default size. Filing it
    // here as well would double it into the advisory ratchet under a label claiming it was
    // measured at 200%.
    const absorbed = pageAnswering({
      layout: {
        clippedControls: ["#save-register"],
        coveredControls: [],
        pageOverflow: { clientWidth: 390, scrollWidth: 612 },
      },
      rootFontSize: 32,
      sample: {
        body: { baseline: 16, raised: 16 },
        root: { baseline: 16, raised: 32 },
        sampled: [{ baseline: 13, raised: 13, target: "td.coach-fee-amount" }],
      },
    })
    const audited = await auditTextResizeLayout({
      client: absorbed.client,
      page: absorbed.page,
      viewport: accessibilityViewports[2],
    })
    expect(audited.findings.map((item) => item.id)).toEqual(["text-resize-absorbed"])
    expect(audited.advisories).toEqual([])
    expect(absorbed.calls)
      .toEqual(["settled-root-font-size", "layout", "text-scale", "settle", "text-scale", "settle"])
  })

  it("files the advisories once the render is one the reader's setting reached", async () => {
    const live = pageAnswering({
      layout: {
        clippedControls: ["#save-register"],
        coveredControls: [],
        pageOverflow: null,
      },
      rootFontSize: 32,
    })
    const audited = await auditTextResizeLayout({
      client: live.client,
      page: live.page,
      viewport: accessibilityViewports[2],
    })
    expect(audited.findings).toEqual([])
    expect(audited.advisories.map((item) => item.id))
      .toEqual(["text-resize-clipped-interactive-control"])
    // The probe runs after the layout walk, never before it: it lowers the browser
    // preference to take its second reading, and a walk handed a page that had just been
    // shrunk and regrown would be measuring the recovery rather than the render.
    expect(live.calls)
      .toEqual(["settled-root-font-size", "layout", "text-scale", "settle", "text-scale", "settle"])
    // Down to the browser's shipped defaults and back up to the size this pass renders at,
    // in that order. The second half is not optional: the page is reused by every state
    // after this one, and one left at 16px would fail the next state's root reading for a
    // reason that has nothing to do with the next state.
    expect(live.sends).toEqual([BROWSER_DEFAULT_FONT_SIZES, TEXT_RESIZE_FONT_SIZES])
  })
})

/*
 * A browser that behaves the way the one in CI behaved, so that this file can hold the
 * failure the last round shipped.
 *
 * Run 32967379162 reported `text-resize-probe-not-applied` on 55 of 55 audits and
 * `text-resize-absorbed` on none: the probe wrote `font-size: 16px` onto the root element
 * and read the root back, and got the raised size both times. Reproduced afterwards over raw
 * CDP against Chrome for Testing 151.0.7922.34 — the build the workflow installs — driving
 * the app's own stylesheets in a fresh browser context: a font-size change read back in the
 * same task reports the size from before the change, on every attempt, and the root, `body`,
 * every rem-sized descendant and the document height have all followed two animation frames
 * later. That is the one behaviour modelled here, and it is the only thing this fake adds to
 * a DOM: `applied` trails `preference` until a frame runs.
 *
 * The page functions under test are executed rather than stubbed. That is the point. A fake
 * that answered `evaluate` from a script would agree with any probe that asked politely,
 * including the one that shipped broken; this one makes the real walk read a real
 * `getComputedStyle` on real elements, so a probe that reads before the frame gets the same
 * answer twice here that it got in CI. The layout walk is the one exception — it belongs to
 * accessibility-audit.ts, wants a whole document, and is recognised by the `scope` in its
 * argument.
 */
type ModelElement = {
  className: string
  /** Absolute, so it cannot answer the root. */
  px?: number
  /** Relative to the root, the way every converted declaration in these sheets is. */
  rem?: number
  /** Inherited from `body`, which is how most of the document is sized. */
  inherits?: boolean
  localName: string
  text: string
}

function chromiumFontSizeModel({
  bodyPx,
  elements,
  layout = CLEAN_LAYOUT,
  unrestyled = false,
}: {
  bodyPx?: number
  elements: ModelElement[]
  layout?: LayoutAudit
  /** Start with the root already at the raised size and the document still laid out at the
   *  browser default -- the state run 32967379162's own failure screenshots were taken in. */
  unrestyled?: boolean
}) {
  // The browser's own default font size. Only Page.setFontSizes moves it.
  let preference = TEXT_RESIZE_FONT_SIZES.standard
  // An inline `font-size` on the root, which is what the probe that shipped last round used.
  // It reaches the render by the same two stages a preference change does, and that is the
  // whole of why it read as inert: nothing here advances without an animation frame.
  let inlineRoot: number | null = null
  const target = () => inlineRoot ?? preference

  // Two stages, because two is what was measured. A document whose root already reported
  // 16px still reported `body` at 32px in the same task, and matched only a frame later. A
  // probe that waited for the root alone would read a halved root beside unhalved text and
  // report the page as having absorbed the reader's setting — a false accusation, which is
  // worse than the silence this round is repairing.
  let renderedRoot = preference
  let renderedText = unrestyled ? BROWSER_DEFAULT_FONT_SIZES.standard : preference
  const commitFrame = () => {
    if (renderedRoot !== target()) renderedRoot = target()
    else renderedText = target()
  }

  const bodyFontSize = () => bodyPx ?? renderedText
  const sizeOf = (element: ModelElement) => {
    if (element.px !== undefined) return element.px
    if (element.inherits) return bodyFontSize()
    return (element.rem ?? 1) * renderedText
  }

  const attributesOf = new Map<object, Map<string, string>>()
  const node = (element: ModelElement) => {
    const attributes = new Map<string, string>()
    const fake = {
      childNodes: [{ nodeType: 3, textContent: element.text }],
      classList: element.className ? [element.className] : [],
      getAttribute: (name: string) => attributes.get(name) ?? null,
      getBoundingClientRect: () => ({ height: 20, width: 120 }),
      id: "",
      localName: element.localName,
      removeAttribute: (name: string) => { attributes.delete(name) },
      setAttribute: (name: string, value: string) => { attributes.set(name, String(value)) },
      source: element,
    }
    attributesOf.set(fake, attributes)
    return fake
  }
  const nodes = elements.map(node)

  const rootStyle = {
    get fontSize() { return inlineRoot === null ? "" : `${inlineRoot}px` },
    set fontSize(value: string) {
      inlineRoot = value.trim() ? Number.parseFloat(value) : null
    },
    removeProperty(property: string) { if (property === "font-size") inlineRoot = null },
  }
  const documentElement = { style: rootStyle }
  const body = {}

  const globals = {
    CSS: { escape: (value: string) => value },
    document: {
      body,
      createTreeWalker: () => {
        let index = 0
        return { nextNode: () => (index < nodes.length ? nodes[index++] : null) }
      },
      documentElement,
      querySelectorAll: (selector: string) => {
        const attribute = selector.replace(/^\[|\]$/gu, "")
        return nodes.filter((candidate) => attributesOf.get(candidate)?.has(attribute))
      },
    },
    getComputedStyle: (element: object) => {
      if (element === documentElement) return { fontSize: `${renderedRoot}px` }
      if (element === body) return { fontSize: `${bodyFontSize()}px` }
      const found = nodes.find((candidate) => candidate === element)
      if (!found) {
        throw new Error("getComputedStyle was called on an element this model never rendered")
      }
      return { fontSize: `${sizeOf(found.source)}px` }
    },
    Node: { TEXT_NODE: 3 },
    NodeFilter: { SHOW_ELEMENT: 1 },
    window: {
      requestAnimationFrame: (callback: (time: number) => void) => {
        queueMicrotask(() => {
          // The frame is where a pending font-size change reaches the document.
          commitFrame()
          callback(0)
        })
        return 1
      },
    },
  }

  const sends: { fixed: number; standard: number }[] = []
  const page = {
    evaluate: async (run: (argument: unknown) => unknown, argument: unknown) => {
      // The one call that belongs to accessibility-audit.ts rather than to the probe.
      if (argument && typeof argument === "object" && "scope" in argument) return layout
      return run(argument)
    },
  }
  const client = {
    send: async (method: string, params: { fontSizes: { fixed: number; standard: number } }) => {
      expect(method).toBe("Page.setFontSizes")
      sends.push(params.fontSizes)
      preference = params.fontSizes.standard
    },
  }

  return {
    client: client as unknown as CDPSession,
    page: page as unknown as Page,
    get preference() { return preference },
    get renderedRootFontSize() { return renderedRoot },
    get renderedTextFontSize() { return renderedText },
    sends,
    async run<T>(body: () => Promise<T>) {
      const restore = Object.entries(globals).map(([name, value]) => {
        const previous = (globalThis as Record<string, unknown>)[name]
        ;(globalThis as Record<string, unknown>)[name] = value
        return () => { (globalThis as Record<string, unknown>)[name] = previous }
      })
      try {
        return await body()
      } finally {
        for (const undo of restore) undo()
      }
    },
  }
}

/*
 * The half of the guard the last round could not measure, against a browser that reproduces
 * why.
 *
 * These do not check that the probe is written a particular way. They check that a probe put
 * in front of the browser CI ran gets an answer out of it — the previous one did not, on all
 * 55 audits — and that the answer is still a verdict on the page rather than on the probe.
 */
describe("the probe, against a browser that answers the way the one in CI did", () => {
  const remSizedPage = () => ([
    { className: "coach-fee-amount", inherits: true, localName: "td", text: "₹5,500" },
    { className: "coach-fee-label", localName: "span", rem: 0.6875, text: "Billed" },
    { className: "coach-fee-date", localName: "time", rem: 0.75, text: "5 Aug 2026" },
  ])

  it("gets a second reading out of a browser the inline probe could not move", async () => {
    // The regression. Under the shipped probe every one of these reads the raised size
    // twice, because the write and the read share a task, and auditTextResizeLayout reports
    // text-resize-probe-not-applied — 55 times, which is what run 32967379162 did.
    const browser = chromiumFontSizeModel({ elements: remSizedPage() })
    const audited = await browser.run(() => auditTextResizeLayout({
      client: browser.client,
      page: browser.page,
      viewport: accessibilityViewports[2],
    }))
    expect(audited.findings).toEqual([])
    expect(audited.advisories).toEqual([])
  })

  it("waits for the raised render before it measures one, rather than after", async () => {
    // The state the failure screenshots from run 32967379162 were taken in, and the reason
    // the audit opens with a wait instead of a bare root read. The root reports the raised
    // size while the document is still laid out at the browser default: a pass that believed
    // the root would hand its layout walk the ordinary render, and would then read `body`
    // unmoved at both preferences and file text-resize-absorbed against a page whose type is
    // entirely in rem. Accusing the page of what the browser did is the one outcome worse
    // than the silence this round is repairing.
    const browser = chromiumFontSizeModel({ elements: remSizedPage(), unrestyled: true })
    expect(browser.renderedTextFontSize).toBe(BROWSER_DEFAULT_FONT_SIZES.standard)
    const audited = await browser.run(() => auditTextResizeLayout({
      client: browser.client,
      page: browser.page,
      viewport: accessibilityViewports[2],
    }))
    expect(audited.findings).toEqual([])
    expect(browser.renderedTextFontSize).toBe(TEXT_RESIZE_FONT_SIZES.standard)
  })

  it("lowers the browser preference and puts it back where it found it", async () => {
    // The page is reused by every state after this one and every one of them opens with a
    // root reading. A probe that left the preference at the browser default would fail all
    // of them, and the message would name the page rather than the probe.
    const browser = chromiumFontSizeModel({ elements: remSizedPage() })
    await browser.run(() => auditTextResizeLayout({
      client: browser.client,
      page: browser.page,
      viewport: accessibilityViewports[2],
    }))
    expect(browser.sends).toEqual([BROWSER_DEFAULT_FONT_SIZES, TEXT_RESIZE_FONT_SIZES])
    expect(browser.preference).toBe(TEXT_RESIZE_FONT_SIZES.standard)
    // And it waited for the restore to reach the document, rather than sending it and
    // walking away: the render this leaves behind is the one it measured, which is the
    // render a failure screenshot captures. Both stages, not just the root — a page whose
    // root had come back to 32px while its text was still at 16px would put a screenshot of
    // the ordinary render beside a finding that claims to have been taken at 200%.
    expect(browser.renderedRootFontSize).toBe(TEXT_RESIZE_FONT_SIZES.standard)
    expect(browser.renderedTextFontSize).toBe(TEXT_RESIZE_FONT_SIZES.standard)
  })

  it("still fails the page that absorbs the reader's setting", async () => {
    // The inertness detection, which is the only reason this pass costs 55 audits. Reverting
    // `body { font-size: 1rem }` to `body { font-size: 16px }` has to turn the gate red, and
    // the whole objection to the last round was that it could not.
    const browser = chromiumFontSizeModel({
      bodyPx: BROWSER_DEFAULT_FONT_SIZES.standard,
      elements: [
        { className: "coach-fee-amount", inherits: true, localName: "td", text: "₹5,500" },
        { className: "coach-fee-label", inherits: true, localName: "span", text: "Billed" },
      ],
    })
    const audited = await browser.run(() => auditTextResizeLayout({
      client: browser.client,
      page: browser.page,
      viewport: accessibilityViewports[2],
    }))
    expect(audited.findings.map((item) => item.id)).toEqual(["text-resize-absorbed"])
    expect(audited.findings[0].message).toContain("body computed to 16px at the raised root")
    expect(audited.findings[0].message).toContain("0 of 2 sampled text elements moved")
    // Still restored, even on the failing path.
    expect(browser.preference).toBe(TEXT_RESIZE_FONT_SIZES.standard)
  })

  it("names the element that did not move, by the selector it was sampled under", async () => {
    // The narrower case the sample exists for: `body` follows the root and a subtree does
    // not. It also pins the join between the two readings — the raised reading names the
    // element, the baseline reading is taken after a CDP round trip, and pairing them by
    // position is the thing that would silently mismatch if the walk were re-run instead.
    const browser = chromiumFontSizeModel({
      elements: [
        { className: "coach-fee-amount", localName: "td", px: 13, text: "₹5,500" },
        { className: "coach-fee-label", localName: "span", px: 11, text: "Billed" },
      ],
    })
    const audited = await browser.run(() => auditTextResizeLayout({
      client: browser.client,
      page: browser.page,
      viewport: accessibilityViewports[2],
    }))
    expect(audited.findings.map((item) => item.id)).toEqual(["text-resize-absorbed"])
    expect(audited.findings[0].targets)
      .toEqual(["body", "td.coach-fee-amount", "span.coach-fee-label"])
    expect(audited.findings[0].message).toContain("td.coach-fee-amount at 13px")
  })

  it("leaves no probe attributes on the page it measured", async () => {
    // The sample is carried between the two readings on a data attribute, because a CDP
    // round trip sits between them. Anything left behind would be visible to the ordinary
    // pass on the next state and to every screenshot taken afterwards.
    const browser = chromiumFontSizeModel({ elements: remSizedPage() })
    await browser.run(() => auditTextResizeLayout({
      client: browser.client,
      page: browser.page,
      viewport: accessibilityViewports[2],
    }))
    const remaining = await browser.run(async () => browser.page.evaluate(
      () => document.querySelectorAll("[data-text-resize-sample]").length,
      undefined,
    ))
    expect(remaining).toBe(0)
  })
})

describe("what the text-resize pass measures", () => {
  const layout = {
    clippedControls: ['button[aria-label="Mark present"]'],
    coveredControls: [{ covering: ".portal-header", target: "#save-register" }],
    pageOverflow: { clientWidth: 390, scrollWidth: 612 },
  }

  it("reuses the three layout measurements and adds none of its own", () => {
    // The whole reason layoutFindings was lifted out of domFindings: one
    // definition of each measurement, so the resize pass cannot describe an
    // overflow in different words from the pass that already reports one.
    expect(layoutFindings(layout)).toEqual([
      {
        id: "document-horizontal-overflow",
        impact: "serious",
        message: "Document width is 612px at a 390px viewport.",
        source: "layout",
        targets: ["html"],
      },
      {
        id: "clipped-interactive-control",
        impact: "serious",
        message: "An interactive control crosses the horizontal viewport edge.",
        source: "layout",
        targets: ['button[aria-label="Mark present"]'],
      },
      {
        id: "covered-interactive-control",
        impact: "serious",
        message: "The centre of an interactive control is covered by .portal-header.",
        source: "layout",
        targets: ["#save-register"],
      },
    ])
  })

  it("reports nothing at all for a layout that still holds", () => {
    expect(layoutFindings({
      clippedControls: [],
      coveredControls: [],
      pageOverflow: null,
    })).toEqual([])
  })

  it("keeps its rule ids out of the namespace the ordinary pass fails the build on", () => {
    // A shared id would put a blocking count and an advisory count of the same
    // name into one ratchet, and the recorded ceiling would stop meaning
    // anything: nobody could tell which pass had moved.
    const blockingIds = layoutFindings(layout).map((item) => item.id)
    const advisories = textResizeAdvisories(layoutFindings(layout), 32, 32)
    expect(advisories.map((item) => item.id)).toEqual([
      "text-resize-document-horizontal-overflow",
      "text-resize-clipped-interactive-control",
      "text-resize-covered-interactive-control",
    ])
    for (const advisory of advisories) expect(blockingIds).not.toContain(advisory.id)
  })

  it("says what size it was rendered at, in the finding a human will read", () => {
    const [overflow] = textResizeAdvisories(layoutFindings(layout), 32, 32)
    expect(overflow.category).toBe("text-resize")
    expect(overflow.message)
      .toBe("At a 32px root font size (200% of the browser default): Document width is 612px at a 390px viewport.")
    expect(overflow.targets).toEqual(["html"])
    expect(overflow.impact).toBe("serious")
  })
})

describe("the ratchet the text-resize pass reports through", () => {
  const advisories = textResizeAdvisories(layoutFindings({
    clippedControls: ["#save-register"],
    coveredControls: [],
    pageOverflow: { clientWidth: 390, scrollWidth: 612 },
  }), 32, 32)

  it("fails a rule the baseline has never recorded, and passes one under its ceiling", () => {
    const results = [textResizeResult(advisories)]
    expect(accessibilityAdvisoryRegressions(results, { profiles: { stress: {} } })).toEqual([
      "stress · text-resize-clipped-interactive-control: 1 advisories exceed the recorded baseline of 0",
      "stress · text-resize-document-horizontal-overflow: 1 advisories exceed the recorded baseline of 0",
    ])
    expect(accessibilityAdvisoryRegressions(results, {
      profiles: {
        stress: {
          "text-resize-clipped-interactive-control": 1,
          "text-resize-document-horizontal-overflow": 4,
        },
      },
    })).toEqual([])
  })

  it("refuses to record a text-resize ceiling that would rise", () => {
    // The half of the ratchet that keeps the recorded debt from growing: the
    // updater is the only writer, and it asks this before it writes.
    expect(accessibilityAdvisoryIncreases(
      { stress: { "text-resize-document-horizontal-overflow": 4 } },
      { stress: { "text-resize-document-horizontal-overflow": 5 } },
    )).toEqual(["stress · text-resize-document-horizontal-overflow: 4 → 5"])
    expect(accessibilityAdvisoryIncreases(
      { stress: { "text-resize-document-horizontal-overflow": 4 } },
      { stress: { "text-resize-document-horizontal-overflow": 2 } },
    )).toEqual([])
  })

  it("counts as its own category and says so in the job summary", () => {
    const results = [textResizeResult(advisories)]
    expect(countAccessibilityAdvisories(results)).toEqual({
      "best-practice": 0,
      "best-practice-needs-review": 0,
      "needs-review": 0,
      "text-resize": 2,
    })
    const summary = buildAccessibilitySummary(results, [])
    expect(summary).toContain("- Text resize: 2")
    expect(summary).toContain("| text-resize | text-resize-document-horizontal-overflow | 1 | 1 |")
  })
})

describe("the states the text-resize pass covers", () => {
  it("covers the courtside registers, the fee tables and the member directory", () => {
    const ids = textResizeStates.map((state) => state.id)
    for (const id of [
      "coach-player-attendance-register",
      "coach-player-attendance-record",
      "coach-staff-attendance-register",
      "coach-staff-roll-call",
      "coach-monthly-fees",
      "coach-registration-fees",
      "coach-collections",
      "coach-player-financial-record",
      "coach-members-filters",
      "coach-members-details",
    ]) {
      expect(ids, `${id} is missing from the text-resize pass`).toContain(id)
    }
    // Every one is a state the ordinary matrix already audits, so the two passes
    // describe the same routes at two font sizes rather than two route lists.
    const matrixIds = new Set(accessibilityStates.map((state) => state.id))
    for (const id of ids) expect(matrixIds.has(id)).toBe(true)
  })

  it("leaves the marketing surfaces to the ordinary pass", () => {
    // Not a taste call: those states are guest-facing, their type is already
    // fluid, and spending the budget there would buy less than spending it on a
    // register a coach fills in courtside.
    for (const state of textResizeStates) {
      expect(state.actor).not.toBe("guest")
      expect(state.profile).toBe("stress")
    }
  })

  it("fits the subset inside the time the accessibility job has left", () => {
    // The claim the subset comment makes, as a number. 25 minutes covers three
    // profiles, a production build and a Playwright install; a second full pass
    // over the stress matrix would not fit inside what is left.
    const stressAudits = statesForProfile("stress")
      .reduce((total, state) => total + viewportsForState(state).length, 0)
    expect(stressAudits).toBe(153)
    expect(textResizeAuditCount()).toBe(55)
    expect(textResizeAuditCount()).toBeLessThan(stressAudits * 0.4)

    // And the part of the cost the subset comment used to get wrong, as the numbers it now
    // quotes. The 55 skip no navigation: every one pays a goto and two settles, exactly as
    // auditMatrixState and auditCurrentPage do together, so 110 settles across the sweep
    // rather than the 55 a "small fraction of the per-audit cost" would imply. Only the
    // measuring half is skipped. This pins the arithmetic behind the claim; the spec is
    // what spends it.
    expect(textResizeAuditCount() * 2).toBe(110)
    expect(textResizeStates.filter((state) => state.interaction)).toHaveLength(4)
  })

  it("reaches every covered state through a session the stress run already opens", () => {
    // A state assigned to an actor whose context the run never opens would be
    // silently skipped, and a skipped text-resize state produces no advisory, no
    // breach and a green gate.
    const swept = ["head-coach", "junior-coach", "player"] as const
    const reached = swept.flatMap((actor) => textResizeStatesForActor(actor))
    expect(reached.map((state) => state.id).sort())
      .toEqual(textResizeStates.map((state) => state.id).sort())
  })

  it("refuses a state id the matrix no longer has, rather than covering one fewer surface", () => {
    expect(() => resolveTextResizeStates(["coach-monthly-fees", "coach-fees-renamed"]))
      .toThrow(/"coach-fees-renamed", which is not in accessibilityStates/u)
    expect(resolveTextResizeStates(["coach-monthly-fees"]).map((state) => state.id))
      .toEqual(["coach-monthly-fees"])
  })

  it("gives its results ids no matrix state can collide with", () => {
    expect(textResizeResultId("coach-monthly-fees")).toBe("coach-monthly-fees#text-200")
    expect(isTextResizeResultId(textResizeResultId("coach-monthly-fees"))).toBe(true)
    for (const state of accessibilityStates) {
      expect(isTextResizeResultId(state.id), `${state.id} collides with a text-resize result id`)
        .toBe(false)
    }
  })
})

describe("the precondition that makes a browser font-size preference visible", () => {
  /*
   * Page.setFontSizes moves the root element's `font-size: medium` initial
   * value. A stylesheet that declares a root font-size takes that back: the
   * reader's setting stops reaching the page, and the pass stops measuring the
   * magnification it records a ceiling against. auditTextResizeLayout catches
   * that at run time, but only after a fixture build, a production build and a
   * Playwright run -- a whole CI job to learn something a parse can answer here.
   *
   * There are two ways to take the setting back and they need different rules.
   * On the root, *any* font size is fatal to this pass: even `62.5%` scales with
   * the reader and still lands somewhere other than 200%, so the ceiling would
   * belong to a magnification nobody chose. One level down, on `body`, a
   * relative size is exactly right -- app/globals.css declares
   * `body { font-size: 1rem }` -- and an absolute one freezes every inherited
   * word in the document while the root reading still says 32px. The px-to-rem
   * conversion in this campaign is what made that line relative, and the
   * requirement that it stay relative is the one this case states out loud
   * rather than leaving to a comment in a commit message.
   *
   * The parse is the one from tests/accessibility-hardening.test.ts's root
   * overflow guard, for the same reason it gives: `html` is not the only way to
   * select the root element, and app/globals.css already declares `:root` twice.
   */
  const rulesIn = (contents: string) => [
    ...contents.replace(/\/\*[\s\S]*?\*\//gu, "").matchAll(/([^{}]+)\{([^{}]*)\}/gu),
  ].map((match) => ({
    body: match[2],
    selectors: match[1].split(",").map((selector) => selector.trim()),
  }))

  // `font` is matched as well as `font-size` because the shorthand resets it.
  // `font-family`, `font-weight`, `font-size-adjust` and the rest do not, and
  // the optional group is what keeps them out: after `font` the pattern needs a
  // colon, or `-size` and then a colon, which none of them offers.
  const rootFontSizeSelectors = (contents: string) => rulesIn(contents)
    .filter((rule) => /(?:^|[;\s])font(?:-size)?\s*:/u.test(rule.body))
    .flatMap((rule) => rule.selectors)
    .filter((selector) => /^(?:html|:root)(?![\w-])/u.test(selector.split(/[\s>+~]+/u).at(-1) ?? ""))

  // A length the root cannot move, in any unit and any case. The same set
  // tests/design-tokens.test.ts scans the whole sheet for, restated here rather
  // than imported because that guard's subject is unit drift across 767
  // declarations and this one's is a single line's effect on the pass below --
  // and a shared constant would let a future exemption written for the first
  // silently widen the second.
  const ABSOLUTE_LENGTH = /(?<![-\w.])\d+(?:\.\d+)?(?:px|pt|pc|in|cm|mm|q)(?![\w-])/iu

  // The subject is the last compound of each selector, as above. `body` reached
  // through a descendant combinator -- `body p` -- is a paragraph rule and not
  // this one's business; `.body-copy` is not `body` at all.
  const absoluteBodyFontSizes = (contents: string) => rulesIn(contents)
    .filter((rule) => rule.selectors.some((selector) => (
      /^body(?![\w-])/u.test(selector.split(/[\s>+~]+/u).at(-1) ?? "")
    )))
    .flatMap((rule) => [...rule.body.matchAll(/(?:^|[;\s])font(?:-size)?\s*:([^;]+)/gu)])
    .map((match) => match[1].trim())
    .filter((value) => ABSOLUTE_LENGTH.test(value))

  it("recognises every way of putting a font size on the root element", () => {
    expect(rootFontSizeSelectors("html { font-size: 20px }")).toEqual(["html"])
    expect(rootFontSizeSelectors(":root { font-size: 62.5% }")).toEqual([":root"])
    expect(rootFontSizeSelectors("html.compact { font-size: 14px }")).toEqual(["html.compact"])
    expect(rootFontSizeSelectors("html { font: 400 20px/1.5 Manrope }")).toEqual(["html"])
    expect(rootFontSizeSelectors("@media (width < 430px) { :root { font-size: 15px } }"))
      .toEqual([":root"])

    expect(rootFontSizeSelectors("html .card { font-size: 13px }")).toEqual([])
    expect(rootFontSizeSelectors("html { font-family: Manrope }")).toEqual([])
    expect(rootFontSizeSelectors("html { font-weight: 570 }")).toEqual([])
    expect(rootFontSizeSelectors("html { font-size-adjust: 0.5 }")).toEqual([])
    // `body` is genuinely not the root, and this parse is right to say so -- the
    // preference still reaches `document.documentElement` with that rule in
    // place, which is exactly why a root reading cannot see it. It is the case
    // below that owns `body`, and it has to, because for a while this line was
    // the only thing said about `body { font-size: 16px }` anywhere and it read
    // as a clean bill of health for the one declaration that decides whether the
    // pass has anything to catch.
    expect(rootFontSizeSelectors("body { font-size: 16px }")).toEqual([])
  })

  it("recognises an absolute font size on the element the document inherits from", () => {
    expect(absoluteBodyFontSizes("body { font-size: 16px }")).toEqual(["16px"])
    expect(absoluteBodyFontSizes("body { font-size: 12.5px }")).toEqual(["12.5px"])
    expect(absoluteBodyFontSizes("body { font-size: 12pt }")).toEqual(["12pt"])
    expect(absoluteBodyFontSizes("body { font: 400 16px/1.6 Manrope }"))
      .toEqual(["400 16px/1.6 Manrope"])
    expect(absoluteBodyFontSizes("@media (width < 430px) { body { font-size: 15px } }"))
      .toEqual(["15px"])

    // Relative is the whole point: these all move with the reader.
    expect(absoluteBodyFontSizes("body { font-size: 1rem }")).toEqual([])
    expect(absoluteBodyFontSizes("body { font-size: 100% }")).toEqual([])
    expect(absoluteBodyFontSizes("body { font-size: medium }")).toEqual([])
    // And these are not `body`.
    expect(absoluteBodyFontSizes(".body-copy { font-size: 13px }")).toEqual([])
    expect(absoluteBodyFontSizes("body p { font-size: 13px }")).toEqual([])
    expect(absoluteBodyFontSizes("body { font-weight: 570 }")).toEqual([])
  })

  const stylesheetsUnder = (directory: string): string[] => (
    readdirSync(path.join(process.cwd(), directory), { withFileTypes: true })
      .flatMap((entry) => {
        const relative = path.join(directory, entry.name)
        if (entry.isDirectory()) return stylesheetsUnder(relative)
        return entry.name.endsWith(".css") ? [relative] : []
      })
  )

  it("leaves the root, and the size body inherits from it, to the reader", () => {
    // Discovered rather than listed, because a listed set goes stale silently:
    // the fourteenth stylesheet is the one that would take the setting back
    // without this ever noticing. A CSS module is included for the same reason
    // -- `:root` inside one is not scoped the way its class selectors are.
    const stylesheets = [...stylesheetsUnder("app"), ...stylesheetsUnder("components")]
    expect(stylesheets).toContain("app/globals.css")
    expect(stylesheets).toContain("app/portal.css")
    expect(stylesheets).toContain("app/public-home.css")
    expect(stylesheets.length).toBeGreaterThanOrEqual(13)
    for (const stylesheet of stylesheets) {
      const contents = readFileSync(path.join(process.cwd(), stylesheet), "utf8")
      expect(rootFontSizeSelectors(contents), stylesheet).toEqual([])
      expect(absoluteBodyFontSizes(contents), stylesheet).toEqual([])
    }
  })
})
