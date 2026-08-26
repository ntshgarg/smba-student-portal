import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"

import { captureMaskedFailure } from "./failure-evidence"

import type {
  AccessibilityActor,
  AccessibilityProfile,
  AccessibilityViewport,
} from "./accessibility-matrix"

const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const

// Every landmark and structural rule axe ships — region, landmark-one-main,
// landmark-unique, aria-allowed-role — carries only this tag, so the WCAG tags
// above never evaluate them.
const BEST_PRACTICE_TAGS = ["best-practice"] as const

// Rule ids that block the gate wherever they surface, including the incomplete
// bucket and the best-practice pass above. Incomplete is where axe files the
// checks it could not decide on its own, which is where contrast over gradients
// and images lands, so leaving it advisory made the one contrast class axe
// cannot auto-resolve the one class the gate could not fail on. The three
// landmark rules are here because BEST_PRACTICE_TAGS is the only pass that
// evaluates them; main-landmark-count in domFindings already recovers
// landmark-one-main from the DOM side, and this covers the other two.
const BLOCKING_ADVISORY_RULES: ReadonlySet<string> = new Set([
  "aria-hidden-focus",
  "aria-prohibited-attr",
  "color-contrast",
  "landmark-one-main",
  "landmark-unique",
  "link-in-text-block",
  "region",
])

// Resolved from the repository root, the way playwright.accessibility.config.ts
// resolves its own output root: playwright test, vitest and the tsx scripts all
// run from there.
export const accessibilityAdvisoryBaselinePath = path.resolve(
  "tests/e2e/support/accessibility-advisory-baseline.json",
)

const RECORD_BASELINE_COMMAND =
  "npx tsx scripts/regression/update-accessibility-advisory-baseline.ts"

export type AccessibilityFinding = {
  helpUrl?: string
  id: string
  impact: "critical" | "serious" | "moderate" | "minor"
  message: string
  source: "axe" | "dom" | "interaction" | "layout"
  targets?: string[]
}

export type AccessibilityAdvisoryCategory =
  | "best-practice"
  | "best-practice-needs-review"
  | "needs-review"

export type AccessibilityAdvisory = AccessibilityFinding & {
  category: AccessibilityAdvisoryCategory
}

export type AccessibilityResult = {
  actor: AccessibilityActor
  // What is left after BLOCKING_ADVISORY_RULES has taken its share. These do not
  // fail on their own. accessibilityAdvisoryRegressions holds each rule id to its
  // own ceiling from the checked-in baseline: a rule may not exceed the count
  // recorded for it, and a rule the baseline has never seen has a ceiling of 0.
  // That is a per-rule ceiling, not a monotone total — a rule sitting under its
  // ceiling is free to rise inside it, so the sum of advisories can go up while
  // every ceiling holds. A ceiling only comes down when an operator re-records,
  // and update-accessibility-advisory-baseline.ts refuses to record an increase
  // unless it is passed --allow-increase.
  advisories?: AccessibilityAdvisory[]
  description: string
  findings: AccessibilityFinding[]
  id: string
  profile: AccessibilityProfile
  route: string
  title: string
  url: string
  viewport: AccessibilityViewport
}

type AxeRuleResult = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number]

type DomAudit = {
  ariaReferences: Array<{ attribute: string; id: string; source: string }>
  clippedControls: string[]
  coveredControls: Array<{ covering: string; target: string }>
  duplicateIds: string[]
  headingSkips: string[]
  h1Count: number
  lang: string
  mainCount: number
  mobileFontControls: Array<{ fontSize: number; target: string }>
  pageOverflow: { clientWidth: number; scrollWidth: number } | null
  reducedMotionAnimations: Array<{ animation: string; target: string }>
  title: string
  // `floor` names which of the two minimums the target missed, so the message can
  // say whether it failed WCAG 2.5.8's 24px or this repo's stricter 44px comfort
  // convention without re-deriving it from the number.
  touchTargets: Array<{
    floor: "comfort" | "wcag-2.5.8"
    height: number
    minimum: number
    target: string
    width: number
  }>
}

function severity(value: string | null | undefined): AccessibilityFinding["impact"] {
  if (value === "critical" || value === "serious" || value === "moderate" || value === "minor") {
    return value
  }
  return "moderate"
}

export function sanitizeAccessibilityText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "<redacted-email>")
    .replace(/\b[A-Z2-7]{24,}\b/gu, "<redacted-secret>")
    .replace(/((?:password|pin|totp|recovery[ -]?code)\s*(?:=|:)\s*)[^&\s]+/giu, "$1<redacted>")
    .replace(/((?:[?&]|\b)(?:auth|code|key|session|token)\s*=)[^&\s]+/giu, "$1<redacted>")
}

function finding(input: AccessibilityFinding): AccessibilityFinding {
  return {
    ...input,
    message: sanitizeAccessibilityText(input.message),
    targets: input.targets?.map(sanitizeAccessibilityText),
  }
}

function axeFindings(results: readonly AxeRuleResult[]): AccessibilityFinding[] {
  return results.flatMap((result) => result.nodes.map((node) => finding({
    helpUrl: result.helpUrl,
    id: result.id,
    impact: severity(node.impact ?? result.impact),
    message: `${result.help}: ${node.failureSummary ?? result.description}`,
    source: "axe",
    targets: node.target.map(String),
  })))
}

function axeAdvisories(
  category: AccessibilityAdvisoryCategory,
  results: readonly AxeRuleResult[],
): AccessibilityAdvisory[] {
  return axeFindings(results).map((item) => ({ ...item, category }))
}

/*
 * Only a rule axe DECIDED against is promoted. The first run of this gate
 * promoted `needs-review` as well and produced 1,184 blocking findings across
 * two profiles -- 1,160 of them `color-contrast` on elements whose background
 * axe could not resolve. Those are not defects waiting to be fixed; they are
 * questions, and a build that fails on a question can never go green. They
 * ratchet instead, so the number of unresolved elements can only fall.
 */
const UNDECIDED_CATEGORIES: ReadonlySet<AccessibilityAdvisory["category"]> = new Set([
  "needs-review",
  "best-practice-needs-review",
])

export function promoteBlockingAdvisories(advisories: readonly AccessibilityAdvisory[]) {
  const blocking: AccessibilityFinding[] = []
  const remaining: AccessibilityAdvisory[] = []
  for (const advisory of advisories) {
    if (!BLOCKING_ADVISORY_RULES.has(advisory.id) || UNDECIDED_CATEGORIES.has(advisory.category)) {
      remaining.push(advisory)
      continue
    }
    const { category, ...promoted } = advisory
    blocking.push({
      ...promoted,
      // The category survives in the message because it is the whole difference
      // between "axe proved this fails" and "axe could not decide, look at it".
      message: `${category}: ${promoted.message}`,
    })
  }
  return { blocking, remaining }
}

function domFindings(audit: DomAudit, viewport: AccessibilityViewport) {
  const findings: AccessibilityFinding[] = []
  if (!audit.title.trim()) {
    findings.push(finding({
      id: "document-title",
      impact: "serious",
      message: "The document has no descriptive title.",
      source: "dom",
    }))
  }
  if (!audit.lang.trim()) {
    findings.push(finding({
      id: "html-lang",
      impact: "serious",
      message: "The document language is missing.",
      source: "dom",
      targets: ["html"],
    }))
  }
  if (audit.mainCount !== 1) {
    findings.push(finding({
      id: "main-landmark-count",
      impact: "serious",
      message: `Expected exactly one main landmark; found ${audit.mainCount}.`,
      source: "dom",
      targets: ["main, [role=main]"],
    }))
  }
  if (audit.h1Count !== 1) {
    findings.push(finding({
      id: "page-heading-count",
      impact: "serious",
      message: `Expected exactly one level-one heading; found ${audit.h1Count}.`,
      source: "dom",
      targets: ["h1"],
    }))
  }
  for (const id of audit.duplicateIds) {
    findings.push(finding({
      id: "duplicate-id",
      impact: "serious",
      message: `The id \"${id}\" is used by more than one element.`,
      source: "dom",
      targets: [`#${id}`],
    }))
  }
  for (const reference of audit.ariaReferences) {
    findings.push(finding({
      id: "broken-aria-reference",
      impact: "serious",
      message: `${reference.attribute} references missing id \"${reference.id}\".`,
      source: "dom",
      targets: [reference.source],
    }))
  }
  for (const skip of audit.headingSkips) {
    findings.push(finding({
      id: "heading-order",
      impact: "moderate",
      message: skip,
      source: "dom",
    }))
  }
  if (audit.pageOverflow) {
    findings.push(finding({
      id: "document-horizontal-overflow",
      impact: "serious",
      message: `Document width is ${audit.pageOverflow.scrollWidth}px at a ${audit.pageOverflow.clientWidth}px viewport.`,
      source: "layout",
      targets: ["html"],
    }))
  }
  for (const target of audit.clippedControls) {
    findings.push(finding({
      id: "clipped-interactive-control",
      impact: "serious",
      message: "An interactive control crosses the horizontal viewport edge.",
      source: "layout",
      targets: [target],
    }))
  }
  for (const target of audit.coveredControls) {
    findings.push(finding({
      id: "covered-interactive-control",
      impact: "serious",
      message: `The centre of an interactive control is covered by ${target.covering}.`,
      source: "layout",
      targets: [target.target],
    }))
  }
  for (const target of audit.touchTargets) {
    findings.push(finding({
      id: "touch-target-size",
      impact: "serious",
      // Two different floors, so two different claims. The 24px one is measured
      // against WCAG 2.5.8 but is not a verdict on it — 2.5.8's Inline, Spacing
      // and Essential exceptions are not evaluated here (collectDomAudit), so the
      // message says which floor was missed and stops there.
      message: target.floor === "comfort"
        ? `Interactive target is ${Math.round(target.width)}×${Math.round(target.height)}px, under this repo's`
          + ` ${target.minimum}×${target.minimum}px comfort floor for primary and icon-only controls at touch widths.`
        : `Interactive target is ${Math.round(target.width)}×${Math.round(target.height)}px, under the`
          + ` ${target.minimum}×${target.minimum}px WCAG 2.5.8 minimum. The Inline, Spacing and Essential`
          + " exceptions are not evaluated here, so confirm one does not apply before treating this as a failure.",
      source: "layout",
      targets: [target.target],
    }))
  }
  for (const control of audit.mobileFontControls) {
    findings.push(finding({
      id: "mobile-control-font-size",
      impact: "serious",
      message: `Form control uses ${control.fontSize}px text at ${viewport.width}px; expected at least 16px.`,
      source: "layout",
      targets: [control.target],
    }))
  }
  for (const animation of audit.reducedMotionAnimations) {
    findings.push(finding({
      id: "reduced-motion-animation",
      impact: "moderate",
      message: `Animation \"${animation.animation}\" remains active when reduced motion is requested.`,
      source: "interaction",
      targets: [animation.target],
    }))
  }
  return findings
}

async function collectDomAudit(page: Page, viewport: AccessibilityViewport): Promise<DomAudit> {
  return page.evaluate(({ isCompact, viewportWidth }) => {
    const selectorFor = (element: Element) => {
      if (element.id) return `#${CSS.escape(element.id)}`
      const name = element.getAttribute("name")
      if (name) return `${element.tagName.toLowerCase()}[name=${JSON.stringify(name)}]`
      const label = element.getAttribute("aria-label")
      if (label) return `${element.tagName.toLowerCase()}[aria-label=${JSON.stringify(label)}]`
      const href = element.getAttribute("href")
      if (href) return `${element.tagName.toLowerCase()}[href=${JSON.stringify(href)}]`
      const alt = element.getAttribute("alt")
      if (alt) return `${element.tagName.toLowerCase()}[alt=${JSON.stringify(alt)}]`
      const classes = [...element.classList].slice(0, 2).map((value) => `.${CSS.escape(value)}`).join("")
      return `${element.tagName.toLowerCase()}${classes}`
    }
    const visible = (element: Element) => {
      if ("checkVisibility" in element && !element.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      })) return false
      const closedDetails = element.closest("details:not([open])")
      if (closedDetails && !closedDetails.querySelector("summary")?.contains(element)) return false
      if (element.closest("dialog:not([open]), [hidden]")) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) > 0
        && rect.width > 0
        && rect.height > 0
    }
    const insideHorizontalScroller = (element: Element) => {
      let parent = element.parentElement
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent)
        if (["auto", "scroll"].includes(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1) {
          return true
        }
        parent = parent.parentElement
      }
      return false
    }

    const idCounts = new Map<string, number>()
    document.querySelectorAll("[id]").forEach((element) => {
      const id = element.id
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
    })

    const ariaReferences: DomAudit["ariaReferences"] = []
    const referenceAttributes = [
      "aria-activedescendant",
      "aria-controls",
      "aria-describedby",
      "aria-details",
      "aria-errormessage",
      "aria-labelledby",
      "aria-owns",
    ]
    document.querySelectorAll(referenceAttributes.map((attribute) => `[${attribute}]`).join(","))
      .forEach((element) => {
        for (const attribute of referenceAttributes) {
          const value = element.getAttribute(attribute)
          if (!value) continue
          for (const id of value.trim().split(/\s+/u)) {
            if (!document.getElementById(id)) {
              ariaReferences.push({ attribute, id, source: selectorFor(element) })
            }
          }
        }
      })

    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .filter(visible)
      .map((element) => ({
        level: Number(element.tagName.slice(1)),
        text: element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 80) ?? "",
      }))
    const headingSkips: string[] = []
    for (let index = 1; index < headings.length; index += 1) {
      if (headings[index].level > headings[index - 1].level + 1) {
        headingSkips.push(
          `Heading \"${headings[index].text}\" skips from level ${headings[index - 1].level} to ${headings[index].level}.`,
        )
      }
    }

    const interactiveSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled]):not([type=hidden])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[role=button]:not([aria-disabled=true])",
    ].join(",")
    const openDialog = document.querySelector("dialog[open]")
    const controls = [...document.querySelectorAll(interactiveSelector)]
      .filter((control) => visible(control) && (!openDialog || openDialog.contains(control)))
    const clippedControls: string[] = []
    const coveredControls: DomAudit["coveredControls"] = []
    for (const control of controls) {
      const rect = control.getBoundingClientRect()
      if (!insideHorizontalScroller(control) && (rect.left < -1 || rect.right > viewportWidth + 1)) {
        clippedControls.push(selectorFor(control))
      }
      const centreX = Math.min(viewportWidth - 1, Math.max(0, rect.left + rect.width / 2))
      const centreY = rect.top + rect.height / 2
      if (centreY >= 0 && centreY < innerHeight) {
      const hit = document.elementFromPoint(centreX, centreY)
      if (hit
        && !hit.closest('[aria-hidden="true"]')
        && !control.contains(hit)
        && !hit.contains(control)) {
          coveredControls.push({ covering: selectorFor(hit), target: selectorFor(control) })
        }
      }
    }

    const touchTargets: DomAudit["touchTargets"] = []
    // 2.5.8 Target Size (Minimum) is viewport-independent — 24x24 CSS px binds a
    // trackpad at 1440 exactly as it binds a thumb at 390 — so the collection
    // runs at every width. The width the old guard used was not arbitrary: 820 is
    // this repo's touch-emulation boundary (capture-runtime.ts:163 sets
    // `hasTouch: viewport.width <= 820`), which is the right boundary for a
    // comfort floor and the wrong one for a minimum that has no touch precondition.
    // So only the 44px comfort floor keeps it: that floor is this repo's own
    // convention for primary and icon-only controls under a finger, not a WCAG AA
    // requirement, and it would fail desktop chrome that 2.5.8 permits.
    //
    // This is a floor measurement, not a 2.5.8 verdict: 2.5.8's Inline, Spacing
    // and Essential exceptions are not evaluated here, so a target this names may
    // still conform. axe's own `target-size` does apply the Inline exception
    // (`widget-not-inline-matches`, node_modules/axe-core/axe.js:28305) and runs
    // at every width already, so the two checks are layered rather than duplicated
    // — this one exists for the targets axe files as incomplete or skips, such as
    // RESP-1's `<label>`-wrapped weekday checkbox. The finding message says which
    // of the two it is, and the exception gap is recorded in
    // docs/audit/accessibility-responsiveness.md.
    const comfortFloorApplies = viewportWidth <= 820
    for (const control of controls) {
      const label = control instanceof HTMLInputElement
        && ["checkbox", "radio"].includes(control.type)
        ? control.closest("label")
          ?? (control.id ? document.querySelector(`label[for=${JSON.stringify(control.id)}]`) : null)
        : null
      const rect = (label && visible(label) ? label : control).getBoundingClientRect()
      const text = control.textContent?.trim() ?? ""
      const iconOnly = Boolean(control.getAttribute("aria-label")) && text.length === 0
      const primary = control.matches("button[type=submit], input[type=submit], .login-submit")
        || [...control.classList].some((className) => /primary|submit|openButton/u.test(className))
      const comfort = comfortFloorApplies && (primary || iconOnly)
      const minimum = comfort ? 44 : 24
      if (rect.width + 0.5 < minimum || rect.height + 0.5 < minimum) {
        touchTargets.push({
          floor: comfort ? "comfort" : "wcag-2.5.8",
          height: rect.height,
          minimum,
          target: selectorFor(control),
          width: rect.width,
        })
      }
    }

    const mobileFontControls: DomAudit["mobileFontControls"] = []
    if (viewportWidth <= 430) {
      document.querySelectorAll("input:not([type=hidden]), select, textarea").forEach((control) => {
        if (!visible(control)) return
        if (control instanceof HTMLInputElement
          && ["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"].includes(control.type)) {
          return
        }
        const fontSize = Number.parseFloat(getComputedStyle(control).fontSize)
        if (fontSize < 16) mobileFontControls.push({ fontSize, target: selectorFor(control) })
      })
    }

    const reducedMotionAnimations: DomAudit["reducedMotionAnimations"] = []
    if (isCompact && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.querySelectorAll("body *").forEach((element) => {
        if (!visible(element)) return
        const style = getComputedStyle(element)
        const names = style.animationName.split(",").map((value) => value.trim())
        const durations = style.animationDuration.split(",").map((value) => {
          const trimmed = value.trim()
          return trimmed.endsWith("ms")
            ? Number.parseFloat(trimmed) / 1000
            : Number.parseFloat(trimmed)
        })
        if (names.some((name, index) => name !== "none" && (durations[index] ?? durations[0] ?? 0) > 0.1)) {
          reducedMotionAnimations.push({ animation: style.animationName, target: selectorFor(element) })
        }
      })
    }

    const clientWidth = document.documentElement.clientWidth
    const scrollWidth = document.documentElement.scrollWidth
    return {
      ariaReferences,
      clippedControls: [...new Set(clippedControls)],
      coveredControls: coveredControls.filter((item, index, values) => (
        values.findIndex((candidate) => candidate.target === item.target
          && candidate.covering === item.covering) === index
      )),
      duplicateIds: [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id),
      headingSkips,
      h1Count: headings.filter((heading) => heading.level === 1).length,
      lang: document.documentElement.lang,
      mainCount: document.querySelectorAll("main, [role=main]").length,
      mobileFontControls,
      pageOverflow: scrollWidth > clientWidth + 1 ? { clientWidth, scrollWidth } : null,
      reducedMotionAnimations,
      title: document.title,
      touchTargets,
    }
  }, {
    isCompact: viewport.width <= 430,
    viewportWidth: viewport.width,
  })
}

async function interactionFindings(page: Page) {
  const findings: AccessibilityFinding[] = []
  const invalid = page.locator('[aria-invalid="true"]:visible').first()
  if (await invalid.count()) {
    const focused = await invalid.evaluate((element) => element === document.activeElement)
    if (!focused) {
      findings.push(finding({
        id: "invalid-field-focus",
        impact: "serious",
        message: "Validation did not move focus to the first invalid field.",
        source: "interaction",
      }))
    }
    const describedBy = await invalid.getAttribute("aria-describedby")
    if (!describedBy) {
      findings.push(finding({
        id: "invalid-field-description",
        impact: "serious",
        message: "The invalid field is not associated with explanatory text.",
        source: "interaction",
      }))
    }
  }

  const visibleError = page.locator('[role="alert"]:visible').first()
  if (await invalid.count() && !await visibleError.count()) {
    findings.push(finding({
      id: "validation-announcement",
      impact: "serious",
      message: "Visible validation feedback is not exposed as an alert.",
      source: "interaction",
    }))
  }

  const openDialog = page.locator('dialog[open], [role="dialog"]:visible').first()
  if (await openDialog.count()) {
    const opener = page.locator('[data-accessibility-dialog-opener="true"]').first()
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press("Tab")
      const contained = await openDialog.evaluate((dialog) => {
        const active = document.activeElement
        if (!(active instanceof HTMLElement) || active === document.body) return true
        const interactive = active.matches([
          "a[href]",
          "button:not([disabled])",
          "input:not([disabled])",
          "select:not([disabled])",
          "textarea:not([disabled])",
          "[tabindex]:not([tabindex='-1'])",
        ].join(","))
        return !interactive || dialog.contains(active)
      })
      if (!contained) {
        findings.push(finding({
          id: "dialog-focus-trap",
          impact: "critical",
          message: "Keyboard focus escaped an open dialog.",
          source: "interaction",
        }))
        break
      }
    }
    await page.keyboard.press("Escape")
    if (await openDialog.isVisible().catch(() => false)) {
      findings.push(finding({
        id: "dialog-escape",
        impact: "serious",
        message: "Escape did not close the open dialog.",
        source: "interaction",
      }))
    } else if (await opener.count() && !await opener.evaluate((element) => element === document.activeElement)) {
      findings.push(finding({
        id: "dialog-focus-restoration",
        impact: "serious",
        message: "Closing the dialog did not restore focus to its trigger.",
        source: "interaction",
      }))
    }
  }
  return findings
}

async function keyboardFindings(page: Page) {
  const findings: AccessibilityFinding[] = []
  const skipLink = page.locator('a[href^="#"].skip-link, a[href^="#"][class*="skip"]').first()
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1")
    document.body.focus()
    document.body.removeAttribute("tabindex")
    window.scrollTo({ left: 0, top: 0 })
  })
  await page.keyboard.press("Tab")

  if (await skipLink.count()) {
    if (!await skipLink.evaluate((element) => element === document.activeElement)) {
      findings.push(finding({
        id: "skip-link-order",
        impact: "serious",
        message: "The skip link is not the first keyboard focus target.",
        source: "interaction",
      }))
    } else {
      const targetId = (await skipLink.getAttribute("href"))?.slice(1)
      await page.keyboard.press("Enter")
      if (targetId) {
        const reached = await page.evaluate((id) => {
          const target = document.getElementById(id)
          return Boolean(target && (target === document.activeElement || target.contains(document.activeElement)))
        }, targetId)
        if (!reached) {
          findings.push(finding({
            id: "skip-link-target",
            impact: "serious",
            message: "Activating the skip link did not move focus to its target.",
            source: "interaction",
          }))
        }
      }
    }
  }

  let inspected = 0
  const seen = new Set<string>()
  for (let index = 0; index < 12 && inspected < 6; index += 1) {
    await page.keyboard.press("Tab")
    // Reduced-motion styles collapse transitions to a fraction of a millisecond.
    // Sample after paint so the check measures the indicator users actually see,
    // rather than the transition's zero-width starting frame.
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
    }))
    const state = await page.evaluate(() => {
      const element = document.activeElement
      if (!(element instanceof HTMLElement) || element === document.body) return null
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return {
        focusVisible: element.matches(":focus-visible"),
        key: element.id || `${element.tagName}:${element.textContent?.trim().slice(0, 40) ?? ""}`,
        selector: element.id ? `#${CSS.escape(element.id)}` : element.tagName.toLowerCase(),
        outline: style.outline,
        visibleIndicator: (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0)
          || style.boxShadow !== "none",
        visible: rect.width > 0 && rect.height > 0,
      }
    })
    if (!state?.visible || seen.has(state.key)) continue
    seen.add(state.key)
    inspected += 1
    if (state.focusVisible && !state.visibleIndicator) {
      findings.push(finding({
        id: "focus-visible-indicator",
        impact: "serious",
        message: `A keyboard-focusable control has no visible outline or focus ring (computed outline: ${state.outline || "none"}).`,
        source: "interaction",
        targets: [state.selector],
      }))
    }
  }
  if (!inspected) {
    findings.push(finding({
      id: "keyboard-navigation",
      impact: "serious",
      message: "No keyboard-focusable content could be reached.",
      source: "interaction",
    }))
  }
  return findings
}

async function bestPracticeAdvisories(page: Page): Promise<AccessibilityAdvisory[]> {
  try {
    const audit = await new AxeBuilder({ page }).withTags([...BEST_PRACTICE_TAGS]).analyze()
    return [
      ...axeAdvisories("best-practice", audit.violations),
      ...axeAdvisories("best-practice-needs-review", audit.incomplete),
    ]
  } catch (error) {
    // The caller turns a thrown error into a critical blocking finding, so this
    // pass must not throw and lose the results the blocking pass already has.
    // It no longer disappears either: this id is emitted only when the pass
    // breaks, so the ratchet fails on a rule the baseline has never recorded.
    return [{
      category: "best-practice",
      id: "best-practice-audit",
      impact: "moderate",
      message: sanitizeAccessibilityText(
        `The best-practice pass did not complete: ${error instanceof Error ? error.message : String(error)}`,
      ),
      source: "axe",
    }]
  }
}

export async function auditAccessibilityState({
  actor,
  description,
  id,
  page,
  profile,
  route,
  viewport,
}: {
  actor: AccessibilityActor
  description: string
  id: string
  page: Page
  profile: AccessibilityProfile
  route: string
  viewport: AccessibilityViewport
}): Promise<AccessibilityResult> {
  const axe = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze()
  const findings = axeFindings(axe.violations)
  // Both advisory sets are collected before the checks below move focus and
  // scroll the page, so they describe the same state the blocking pass saw.
  const { blocking, remaining: advisories } = promoteBlockingAdvisories([
    ...axeAdvisories("needs-review", axe.incomplete),
    ...await bestPracticeAdvisories(page),
  ])
  findings.push(...blocking)
  findings.push(...domFindings(await collectDomAudit(page, viewport), viewport))
  findings.push(...await interactionFindings(page))
  findings.push(...await keyboardFindings(page))
  return {
    actor,
    advisories,
    description,
    findings,
    id,
    profile,
    route,
    title: sanitizeAccessibilityText(await page.title()),
    url: sanitizeAccessibilityText(page.url()),
    viewport,
  }
}

export function formatAccessibilityFailures(results: readonly AccessibilityResult[]) {
  return results.flatMap((result) => result.findings.map((item) => {
    const targets = item.targets?.length ? ` [${item.targets.join(", ")}]` : ""
    return `${result.id} · ${result.viewport.label} · ${item.impact} · ${item.id}: ${item.message}${targets}`
  }))
}

export function formatAccessibilityAdvisories(results: readonly AccessibilityResult[]) {
  return results.flatMap((result) => (result.advisories ?? []).map((item) => {
    const targets = item.targets?.length ? ` [${item.targets.join(", ")}]` : ""
    return `${result.id} · ${result.viewport.label} · ${item.category} · ${item.id}: ${item.message}${targets}`
  }))
}

export function countAccessibilityAdvisories(results: readonly AccessibilityResult[]) {
  const counts: Record<AccessibilityAdvisoryCategory, number> = {
    "best-practice": 0,
    "best-practice-needs-review": 0,
    "needs-review": 0,
  }
  for (const result of results) {
    for (const item of result.advisories ?? []) counts[item.category] += 1
  }
  return counts
}

export function accessibilityAdvisoryCountsByRule(results: readonly AccessibilityResult[]) {
  const counts: Record<string, number> = {}
  for (const result of results) {
    for (const item of result.advisories ?? []) {
      counts[item.id] = (counts[item.id] ?? 0) + 1
    }
  }
  // Sorted so the checked-in baseline this feeds stays diffable run to run.
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

export type AccessibilityAdvisoryBaseline = {
  // The academy date each profile's counts were observed at: the value
  // `app/api/health/route.ts` reported for the render, or null for a profile
  // whose fixture follows the runner's own clock and is never pinned. Recorded
  // because a ceiling is a count of a DOM, and the stress fixture renders a
  // different DOM on a different day -- nine cells of the junior-coach ledger
  // move between "not available" and "not recorded" across nine days. Before
  // the pin, drift forced a re-record every few days and kept the number honest
  // by accident; with the pin that pressure is gone, so the clock is recorded
  // beside the counts and accessibilityAdvisoryClockMismatch below refuses to
  // compare counts taken on two different days.
  clocks?: Record<string, string | null>
  // null means "never recorded", which is deliberately not the same as {}: an
  // empty object is a claim that the profile has no advisories, and an absent
  // one has to fail rather than pass on no evidence.
  profiles: Record<string, Record<string, number> | null>
}

// Exported so update-accessibility-advisory-baseline.ts reads the file through
// the same validator the gate does: the writer and the reader cannot disagree
// about what a malformed entry means, and the writer can refuse to overwrite a
// file it could not parse instead of silently replacing recorded ceilings.
export function readAccessibilityAdvisoryBaseline(): {
  baseline: AccessibilityAdvisoryBaseline
  problem: string | null
} {
  const empty: AccessibilityAdvisoryBaseline = { profiles: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(accessibilityAdvisoryBaselinePath, "utf8"))
  } catch (error) {
    return { baseline: empty, problem: error instanceof Error ? error.message : String(error) }
  }
  const profiles = parsed && typeof parsed === "object"
    ? (parsed as { profiles?: unknown }).profiles
    : undefined
  if (!profiles || typeof profiles !== "object") {
    return { baseline: empty, problem: 'the file has no "profiles" object' }
  }
  const recorded: AccessibilityAdvisoryBaseline["profiles"] = {}
  for (const [profile, rules] of Object.entries(profiles as Record<string, unknown>)) {
    if (rules === null) {
      recorded[profile] = null
      continue
    }
    if (!rules || typeof rules !== "object") {
      return { baseline: empty, problem: `profile "${profile}" is neither null nor a rule map` }
    }
    const counts: Record<string, number> = {}
    for (const [rule, count] of Object.entries(rules as Record<string, unknown>)) {
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        return { baseline: empty, problem: `profile "${profile}" rule "${rule}" is not a count` }
      }
      counts[rule] = count
    }
    recorded[profile] = counts
  }
  const clocksValue = (parsed as { clocks?: unknown }).clocks
  if (clocksValue !== undefined && (!clocksValue || typeof clocksValue !== "object")) {
    return { baseline: empty, problem: 'the file has a "clocks" entry that is not an object' }
  }
  const clocks: Record<string, string | null> = {}
  for (const [profile, clock] of Object.entries((clocksValue ?? {}) as Record<string, unknown>)) {
    if (clock !== null && typeof clock !== "string") {
      return { baseline: empty, problem: `profile "${profile}" clock is neither null nor a date` }
    }
    clocks[profile] = clock
  }
  return { baseline: { clocks, profiles: recorded }, problem: null }
}

// The other half of what a recorded ceiling means. accessibilityAdvisoryRegressions
// asks "did this run exceed the recorded count?"; that question is only worth
// asking when both counts describe the same DOM, and the stress fixture's DOM is
// a function of the day it is rendered on. Answering it separately, at import
// rather than after the matrix, is deliberate: an unequal clock is knowable in
// milliseconds and the matrix costs most of the 25-minute CI limit.
//
// A mismatch reports rather than re-records. The recorded 1021 was measured on
// an unpinned run at 2026-08-26; the pin renders 2026-08-17, nine junior-coach
// ledger cells earlier, so leaving 1021 in place under the pin would buy a
// stable gate with permanent headroom -- the exact trade the pin exists to
// avoid. There is no number this file can honestly guess for the pinned render,
// so it refuses until one is measured.
export function accessibilityAdvisoryClockMismatch(
  profile: string,
  fixtureClock: string | null,
  recorded?: AccessibilityAdvisoryBaseline,
): string | null {
  const { baseline, problem } = recorded
    ? { baseline: recorded, problem: null }
    : readAccessibilityAdvisoryBaseline()
  if (problem) {
    return `advisory baseline unreadable (${accessibilityAdvisoryBaselinePath}): ${problem}.`
      + ` Record it with: ${RECORD_BASELINE_COMMAND}`
  }
  // A profile that has never been recorded fails in accessibilityAdvisoryRegressions
  // on stronger grounds than this; do not pre-empt it with a clock complaint.
  if (!baseline.profiles[profile]) return null
  const recordedClock = baseline.clocks?.[profile] ?? null
  if (recordedClock === fixtureClock) return null
  return `${profile} · advisory ceilings were counted against a render at`
    + ` ${describeFixtureClock(recordedClock)}, but this run renders at`
    + ` ${describeFixtureClock(fixtureClock)}. Those are different DOMs, so the recorded counts`
    + " are neither a ceiling nor a floor for this one."
    + ` Re-record them from this run with: ${RECORD_BASELINE_COMMAND}`
}

function describeFixtureClock(clock: string | null) {
  return clock ?? "the runner's own clock"
}

// The writer's half of the ratchet. accessibilityAdvisoryRegressions below asks
// "did this run exceed the recorded ceiling?"; this asks the same question of the
// counts that are about to *become* the recorded ceiling, so
// update-accessibility-advisory-baseline.ts cannot quietly record a number the
// gate would have failed on. Without it the recorded ceiling only ever went where
// the last run put it, up or down, and "the number can only go down" was a claim
// with nothing behind it but a human reading the JSON diff.
export function accessibilityAdvisoryIncreases(
  previous: AccessibilityAdvisoryBaseline["profiles"],
  next: AccessibilityAdvisoryBaseline["profiles"],
): string[] {
  const increases: string[] = []
  for (const [profile, counts] of Object.entries(next)) {
    const recorded = previous[profile]
    // A profile recorded as null, or absent, has no ceiling to raise: its first
    // recording is the ceiling, not a rise above one.
    if (!counts || !recorded) continue
    for (const [rule, count] of Object.entries(counts)) {
      // `?? 0` is the same default the gate uses, so a rule the baseline has
      // never seen counts as a rise the first time it appears.
      const limit = recorded[rule] ?? 0
      if (count > limit) increases.push(`${profile} · ${rule}: ${limit} → ${count}`)
    }
  }
  return increases
}

// The ratchet. Every failure path here is a failure of the gate, never a silent
// pass: an unreadable file, a profile that was never recorded, and a rule the
// baseline has never seen all report. A rule that comes in under its ceiling does
// not, so the recorded number moves only when an operator re-records — and
// accessibilityAdvisoryIncreases above stops that recording moving upward unless
// the operator passes --allow-increase.
export function accessibilityAdvisoryRegressions(
  results: readonly AccessibilityResult[],
  recorded?: AccessibilityAdvisoryBaseline,
): string[] {
  // Every profile that produced a result, not only the ones that produced an
  // advisory. Filtering on `advisories.length` here would let a profile whose run
  // came back clean skip the baseline lookup entirely, so a profile recorded as
  // null — never recorded — would pass on no evidence, which is the one outcome a
  // ratchet must never have. A genuinely clean profile still passes: its observed
  // map is empty, so the per-rule loop below has nothing to compare.
  const audited = [...new Set(results.map((result) => result.profile))].sort()
  // No results at all is not this function's failure to report: summarize-
  // accessibility.ts already exits 1 on an empty run, and the spec cannot reach
  // here without having audited something.
  if (!audited.length) return []
  const { baseline, problem } = recorded
    ? { baseline: recorded, problem: null }
    : readAccessibilityAdvisoryBaseline()
  if (problem) {
    return [`advisory baseline unreadable (${accessibilityAdvisoryBaselinePath}): ${problem}.`
      + ` Record it with: ${RECORD_BASELINE_COMMAND}`]
  }
  const regressions: string[] = []
  for (const profile of audited) {
    const observed = accessibilityAdvisoryCountsByRule(
      results.filter((result) => result.profile === profile),
    )
    const allowed = baseline.profiles[profile]
    if (!allowed) {
      const occurrences = Object.values(observed).reduce((total, count) => total + count, 0)
      regressions.push(`${profile} · advisory baseline never recorded, so there is no ceiling to`
        + ` ratchet this run's ${Object.keys(observed).length} rules / ${occurrences} advisories`
        + ` against. A null entry fails rather than passing on no evidence.`
        + ` Record it with: ${RECORD_BASELINE_COMMAND}`)
      continue
    }
    for (const [rule, count] of Object.entries(observed)) {
      const limit = allowed[rule] ?? 0
      if (count > limit) {
        regressions.push(`${profile} · ${rule}: ${count} advisories exceed the recorded baseline of ${limit}`)
      }
    }
  }
  return regressions
}

function advisorySummaryLines(results: readonly AccessibilityResult[]) {
  const total = formatAccessibilityAdvisories(results).length
  if (!total) return []
  const counts = countAccessibilityAdvisories(results)
  const rules = new Map<string, {
    category: AccessibilityAdvisoryCategory
    id: string
    occurrences: number
    states: Set<string>
  }>()
  for (const result of results) {
    for (const item of result.advisories ?? []) {
      const key = `${item.category}\u0000${item.id}`
      const entry = rules.get(key)
        ?? { category: item.category, id: item.id, occurrences: 0, states: new Set<string>() }
      entry.occurrences += 1
      entry.states.add(result.id)
      rules.set(key, entry)
    }
  }
  const lines = [
    "",
    "### Non-blocking advisories",
    "",
    "What is left once the blocking rule ids have been promoted to findings:"
      + ` ${[...BLOCKING_ADVISORY_RULES].sort().join(", ")}.`
      + " Needs-review items are axe checks that could not decide without a human."
      + " Best-practice items come from rules outside the WCAG tags, which is where"
      + " every landmark rule lives. None of these fails on its own; the ratchet"
      + " section fails when a rule rises above the ceiling recorded for it.",
    "",
    `- Needs review: ${counts["needs-review"]}`,
    `- Best practice: ${counts["best-practice"]}`,
    `- Best practice needs review: ${counts["best-practice-needs-review"]}`,
    `- Advisories: ${total}`,
    "",
    "| Category | Rule | Occurrences | States |",
    "|---|---|---|---|",
  ]
  const ranked = [...rules.entries()]
    .sort(([leftKey, left], [rightKey, right]) => (
      right.occurrences - left.occurrences || leftKey.localeCompare(rightKey)
    ))
  for (const [, entry] of ranked.slice(0, 30)) {
    lines.push(`| ${entry.category} | ${entry.id} | ${entry.occurrences} | ${entry.states.size} |`)
  }
  if (ranked.length > 30) lines.push(`| … | ${ranked.length - 30} further rules | | |`)
  return lines
}

// Separate from advisorySummaryLines because that function returns early when the
// run produced no advisories at all, and the ratchet's loudest failure — a
// profile that was never recorded, or a baseline file that will not parse — is
// exactly the case that can arrive with zero advisories to report.
function advisoryRatchetLines(regressions: readonly string[]) {
  if (!regressions.length) return []
  return [
    "",
    "### Advisory ratchet",
    "",
    "❌ Each line below fails the gate:",
    "",
    ...regressions.map((regression) => `- ${regression}`),
  ]
}

export function buildAccessibilitySummary(
  results: readonly AccessibilityResult[],
  // Passed in by callers that also need the regressions for an exit code, so the
  // summary and the exit code cannot be computed from two different reads of the
  // baseline file. Defaults to reading it, for callers that only want the text.
  regressions: readonly string[] = accessibilityAdvisoryRegressions(results),
) {
  const findings = formatAccessibilityFailures(results)
  const viewports = new Set(results.map((result) => result.viewport.label))
  const states = new Set(results.map((result) => result.id))
  const profiles = new Set(results.map((result) => result.profile))
  const lines = [
    "## UI accessibility / WCAG 2.2 AA",
    "",
    `- Profiles: ${profiles.size}`,
    `- States: ${states.size}`,
    `- Viewports: ${viewports.size}`,
    `- Audits: ${results.length}`,
    `- Findings: ${findings.length}`,
    "",
  ]
  if (!findings.length) {
    // The ratchet fails the same gate, so the tick has to account for it or this
    // summary reads greener than the job outcome it is attached to.
    lines.push(regressions.length
      ? "❌ No findings, but the advisory ratchet below failed."
      : "✅ All audited states passed.")
  } else {
    lines.push("| State | Viewport | Impact | Rule | Evidence |", "|---|---|---|---|---|")
    for (const result of results) {
      for (const item of result.findings.slice(0, 20)) {
        lines.push(`| ${result.id} | ${result.viewport.label} | ${item.impact} | ${item.id} | ${item.message.replaceAll("|", "\\|")} |`)
      }
    }
  }
  lines.push(...advisorySummaryLines(results), ...advisoryRatchetLines(regressions))
  return `${lines.join("\n")}\n`
}

// The day the run rendered at, written beside the results it produced rather
// than left in the operator's shell. update-accessibility-advisory-baseline.ts
// records it into the baseline, and it has to describe the results on disk --
// re-reading an environment variable at recording time would record a claim
// about a run instead of a fact about it, which is the mistake this whole
// finding is about.
const FIXTURE_CLOCK_FILE = "fixture-clock.sanitized.json"

export function readAccessibilityFixtureClock(outputDirectory: string): {
  fixtureClock: string | null
  problem: string | null
} {
  const clockPath = path.join(outputDirectory, FIXTURE_CLOCK_FILE)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(clockPath, "utf8"))
  } catch (error) {
    return {
      fixtureClock: null,
      problem: error instanceof Error ? error.message : String(error),
    }
  }
  const value = parsed && typeof parsed === "object"
    ? (parsed as { fixtureClock?: unknown }).fixtureClock
    : undefined
  if (value !== null && typeof value !== "string") {
    return { fixtureClock: null, problem: `${clockPath} has no "fixtureClock" string or null` }
  }
  return { fixtureClock: value, problem: null }
}

export function writeAccessibilityResults(
  outputDirectory: string,
  results: readonly AccessibilityResult[],
  fixtureClock: string | null,
) {
  mkdirSync(outputDirectory, { recursive: true })
  const jsonPath = path.join(outputDirectory, "results.sanitized.json")
  const summaryPath = path.join(outputDirectory, "summary.sanitized.txt")
  writeFileSync(
    path.join(outputDirectory, FIXTURE_CLOCK_FILE),
    `${JSON.stringify({ fixtureClock }, null, 2)}\n`,
    { mode: 0o600 },
  )
  writeFileSync(jsonPath, `${JSON.stringify(results, null, 2)}\n`, { mode: 0o600 })
  writeFileSync(summaryPath, buildAccessibilitySummary(results), { mode: 0o600 })
  const advisories = countAccessibilityAdvisories(results)
  // The spec attaches this JSON only when the gate fails, so a passing run would
  // otherwise carry no trace of the advisories in its own output.
  console.log(
    `Non-blocking accessibility advisories: ${advisories["needs-review"]} needs-review,`
    + ` ${advisories["best-practice"]} best-practice,`
    + ` ${advisories["best-practice-needs-review"]} best-practice-needs-review`
    + ` (${summaryPath})`,
  )
  return { jsonPath, summaryPath }
}

export { captureMaskedFailure }
