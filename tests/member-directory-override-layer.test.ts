import { describe, expect, it } from "vitest"

import { compounds, indexByCompound, loadCascade, shadowedBy, type CssRule } from "./support/css-cascade"

// The coach-members decision shipped Concept 01 Court Roster Register as an override
// layer over the composition it replaced instead of editing it, so the Member Directory
// was declared twice in one cascade: 40 rules with a verbatim twin, and 77 declarations
// the browser could never use because a later rule with the same compound and the same
// specificity always won. That is not a style preference — an inert declaration is a
// false record of what the directory looks like, and this file had four comments
// reasoning from one. Deleting them changed nothing rendered; this keeps the count at
// zero so the next override lands as an edit.
// The first copy is one contiguous block, anchored on its first and last rule
// rather than on a file: the boundary redraw moved it from app/globals.css to
// app/portal.css without changing a byte of it or its position in the cascade,
// and this has to keep meaning the same thing on either side. Both anchors are
// unique at the top level of the two stylesheets.
const FIRST_RULE = ".coach-members-back-row a"
const LAST_RULE = ".coach-member-empty-state button"
const DIRECTORY_SELECTOR = /(^|[\s,>+~])\.coach-members?-|\.coach-directory-notice/u

function firstCopy(cascade: CssRule[]): CssRule[] {
  let start = cascade.findIndex((rule) => rule.context === "" && rule.selector === FIRST_RULE)
  const end = cascade.findIndex((rule) => rule.context === "" && rule.selector === LAST_RULE)
  if (start < 0 || end < start) throw new Error(`Member Directory first copy not found (${start}..${end})`)
  // The block used to open one rule earlier, on a `.coach-members-directory`
  // whose only declaration was inert. Walk back over any directory rule that
  // reappears above the anchor so re-adding one lands inside the guard.
  while (start > 0 && DIRECTORY_SELECTOR.test(cascade[start - 1].selector) && cascade[start - 1].context === "") {
    start -= 1
  }
  return cascade.slice(start, end + 1)
}

describe("Member Directory override layer", () => {
  const cascade = loadCascade()
  const index = indexByCompound(cascade)

  it("leaves no declaration in the first copy that the override already wins", () => {
    const block = firstCopy(cascade)
    const inert = block.flatMap((rule) => rule.declarations.flatMap((declaration) => {
      const winners = shadowedBy(rule, declaration, index)
      if (!winners) return []
      const beaten = winners.map((winner) => `${winner.rule.file}:${winner.rule.line} {${winner.declaration.text}}`)
      return [`${rule.file}:${declaration.line} ${rule.selector} {${declaration.text}} loses to ${beaten.join(" | ")}`]
    }))

    expect(block.length).toBeGreaterThan(50)
    expect(inert).toEqual([])
  })

  it("still declares the directory once on each side of the pair it could not collapse", () => {
    // Deleting an inert declaration is safe in either direction; moving a live one is
    // not, because the first copy's own responsive layer sits between the two copies.
    // These three rules are the pair that proves it, read in cascade order rather than
    // by file: the (max-width: 900px) override of the folio column is declared after
    // the first copy and before the Court Roster Register section, so the first copy's
    // 36px would beat it if it were folded into that section.
    const th = cascade.filter((rule) => rule.selector === ".coach-member-table tbody th")
    const [firstCopy, override] = th.filter((rule) => rule.context === "")
    const responsive = th.find((rule) => rule.context === "@media (max-width: 900px)")!

    expect(firstCopy.declarations.map((d) => d.text)).toContain("grid-template-columns: 36px minmax(0, 1fr)")
    expect(responsive.declarations.map((d) => d.text)).toContain("grid-template-columns: 40px minmax(0, 1fr)")
    expect(override.declarations.map((d) => d.text)).toContain("display: table-cell")
    expect(firstCopy.index).toBeLessThan(responsive.index)
    expect(responsive.index).toBeLessThan(override.index)
  })

  it("reads the compounds of a selector list as separate match sets", () => {
    // The shadow test is only sound because a comma-separated prelude is several rules
    // wearing one set of braces, so half of one can be dead while the other half renders.
    expect(compounds(".a > b, .c d")).toEqual([".a > b", ".c d"])
    expect(compounds("@media (max-width: 720px)")).toEqual([])
  })
})
