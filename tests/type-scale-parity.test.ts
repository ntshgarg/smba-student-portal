import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { parseRules } from "./support/css-cascade"

/*
 * What this holds, and why it exists.
 *
 * PR #152 raised the five --type-* tokens one pixel each. It moved 131 declarations and
 * left the ~950 longhand ones alone, which reads like a partial migration and is not the
 * problem. The problem is that a longhand literal and a token are only the same size by
 * coincidence, and #152 spent that coincidence: 26 pairs of rules that had rendered at one
 * size for as long as they had existed came out of that commit rendering at two.
 *
 * The worst of them was inside one line of text. components/coach/financials/ledger/
 * refund-form.tsx:259 writes `<span>Reference <em>Optional</em></span>`; `.field > span`
 * was 0.625rem and `.field > span em` was var(--type-operational-floor), which had been
 * 0.625rem too. After #152 "Reference" stayed 10px and "Optional" became 11px.
 * `.concessionApplications` was worse in kind if not in degree -- the rupee amount is a
 * `strong` at 0.625rem and the date caption beneath it a `small` on the token, so the
 * amount came out smaller than its own caption.
 *
 * Nothing caught any of it. tests/design-tokens.test.ts has no --type-* arm; the screenshot
 * suite does not visit /coach/financials/players/[playerId], /coach/announcements or the
 * onboarding register, which is where every verified clash lived.
 *
 * So this asserts the invariant that would have failed on #152 rather than the symptom it
 * produced. Inside one class path and one at-rule context, a raw font-size literal may not
 * equal the value of a --type-* token that the same cluster already uses. Such a literal is
 * a twin that renders identically today and detaches silently the next time the token moves
 * -- there were 29 of them left after the 26 repairs, and defusing them was byte-identical.
 *
 * Deliberately NOT asserted: that no longhand anywhere equals a token value. 85 clusters
 * mix a token with some other token's value, and 389 longhand declarations sit on a token
 * value in clusters that use no token at all. Both are ordinary drift, and app/globals.css:190
 * records why a blanket substitution is the wrong answer -- the 183 longhand sites at
 * 0.6875rem are 60% body text, while the 102 sites already on --type-operational-floor are
 * 60% label, so sweeping them together would leave the token's name describing a fifth of
 * its population. The narrow rule is the one with teeth: it is scoped to clusters that have
 * already adopted the token vocabulary, where the role argument is settled.
 */

const TOKEN_VALUES: Record<string, string> = {
  "--type-operational-action": "0.8125rem",
  "--type-operational-body": "0.875rem",
  "--type-operational-floor": "0.6875rem",
  "--type-utility-label": "0.75rem",
  "--type-utility-meta": "0.8125rem",
}

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return cssFiles(entryPath)
    return entry.isFile() && entry.name.endsWith(".css") ? [entryPath] : []
  })
}

type SizedRule = {
  context: string
  file: string
  line: number
  selector: string
  value: string
}

/** Every font-size the browser resolves, one row per selector in a selector list. */
function sizedRules(): SizedRule[] {
  const projectRoot = process.cwd()
  const files = [
    ...cssFiles(path.join(projectRoot, "app")),
    ...cssFiles(path.join(projectRoot, "components")),
  ]
  const rows: SizedRule[] = []
  for (const file of files) {
    const relative = path.relative(projectRoot, file)
    for (const rule of parseRules(readFileSync(file, "utf8"), relative)) {
      for (const declaration of rule.declarations) {
        const match = /^font-size:\s*(.+)$/u.exec(declaration.text.trim())
        if (!match) continue
        for (const selector of rule.selector.split(",").map((part) => part.trim()).filter(Boolean)) {
          rows.push({
            context: rule.context,
            file: relative,
            line: declaration.line,
            selector,
            value: match[1].trim(),
          })
        }
      }
    }
  }
  return rows
}

/* The class names a selector walks through, which is the closest thing a stylesheet has to
 * "these two rules paint the same component". `.field > span` and `.field > span em` share
 * it; `.focusedLedger .corrections > summary` and `.focusedLedger .ledgerBalance > span` do
 * not, and treating them as siblings is how a first pass at this produced two edits that
 * would have raised a disclosure control to match an unrelated balance label. */
function classPath(selector: string): string {
  return (selector.match(/\.[A-Za-z0-9_-]+/gu) ?? [selector.split(/\s+/u)[0]]).join(">")
}

function clusters(): Map<string, SizedRule[]> {
  // A later declaration for the same selector in the same context wins, so only the last
  // one is what the browser paints -- comparing against a shadowed rule invents clashes.
  const winners = new Map<string, SizedRule>()
  for (const row of sizedRules()) winners.set(`${row.file}|${row.context}|${row.selector}`, row)

  const grouped = new Map<string, SizedRule[]>()
  for (const row of winners.values()) {
    const key = `${row.file}|${row.context}|${classPath(row.selector)}`
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  return grouped
}

describe("operational type scale parity", () => {
  it("never leaves a raw literal twinned with a token the same component already uses", () => {
    const offenders: string[] = []

    for (const rules of clusters().values()) {
      const adopted = rules
        .flatMap((rule) => [...rule.value.matchAll(/var\((--type-[\w-]+)\)/gu)].map((m) => m[1]))
        .filter((token) => token in TOKEN_VALUES)
      if (!adopted.length) continue

      const twinned = new Set(adopted.map((token) => TOKEN_VALUES[token]))
      for (const rule of rules) {
        if (!twinned.has(rule.value)) continue
        const token = adopted.find((name) => TOKEN_VALUES[name] === rule.value)
        offenders.push(
          `${rule.file}:${rule.line} — \`${rule.selector}\` writes ${rule.value}`
            + `${rule.context ? ` inside ${rule.context}` : ""}, the current value of var(${token}),`
            + " which a rule beside it already uses. Write the token instead: the substitution"
            + " renders identically today and stops the pair splitting when the token moves.",
        )
      }
    }

    expect(offenders).toEqual([])
  })

  it("keeps every token a whole pixel apart from the one below it", () => {
    /* The repair above raises a lagging literal onto its neighbour's token, so the scale has
     * to stay ordered for that to mean anything: floor <= label <= meta = action <= body.
     * A future edit that reorders two steps would make some of those 26 repairs a demotion
     * without changing a line of the CSS they touched. */
    const px = (token: string) => Number.parseFloat(TOKEN_VALUES[token]) * 16

    expect(px("--type-operational-floor")).toBeLessThan(px("--type-utility-label"))
    expect(px("--type-utility-label")).toBeLessThan(px("--type-utility-meta"))
    expect(px("--type-utility-meta")).toBe(px("--type-operational-action"))
    expect(px("--type-operational-action")).toBeLessThan(px("--type-operational-body"))

    for (const [token, value] of Object.entries(TOKEN_VALUES)) {
      expect(`${token} is a whole pixel at a 16px root`)
        .toBe(Number.isInteger(px(token)) ? `${token} is a whole pixel at a 16px root` : `${token} is ${value}`)
    }
  })

  it("reads its token values from the stylesheet rather than from this file", () => {
    /* TOKEN_VALUES above is a copy, and a copy that drifts turns both assertions into
     * theatre: the parity check would compare literals against sizes nothing renders. */
    const globals = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8")
    const declared = new Map<string, string>()
    for (const match of globals.matchAll(/(--type-[\w-]+):\s*([\d.]+rem)\s*;/gu)) {
      declared.set(match[1], match[2])
    }

    expect(Object.fromEntries([...declared].sort())).toEqual(
      Object.fromEntries(Object.entries(TOKEN_VALUES).sort()),
    )
  })
})
