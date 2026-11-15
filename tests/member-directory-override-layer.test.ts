import { describe, expect, it } from "vitest"

import { compounds, indexByCompound, loadCascade, shadowedBy } from "./support/css-cascade"

// The Member Directory was once declared twice in one cascade (an override layer
// over the composition it replaced), leaving declarations the browser could never
// use. The 15 Nov 2026 redesign replaced both copies with one block. This keeps
// it that way: no Members declaration may be one a later, equally specific rule
// always beats.
const DIRECTORY_SELECTOR = /(^|[\s,>+~(])\.coach-members?-/u

describe("Member Directory styles", () => {
  const cascade = loadCascade()
  const index = indexByCompound(cascade)

  it("leaves no Members declaration that another rule always wins", () => {
    const block = cascade.filter((rule) => DIRECTORY_SELECTOR.test(rule.selector))
    const inert = block.flatMap((rule) => rule.declarations.flatMap((declaration) => {
      const winners = shadowedBy(rule, declaration, index)
      if (!winners) return []
      const beaten = winners.map((winner) => `${winner.rule.file}:${winner.rule.line} {${winner.declaration.text}}`)
      return [`${rule.file}:${declaration.line} ${rule.selector} {${declaration.text}} loses to ${beaten.join(" | ")}`]
    }))

    expect(block.length).toBeGreaterThan(50)
    expect(inert).toEqual([])
  })

  it("reads the compounds of a selector list as separate match sets", () => {
    // The shadow test is only sound because a comma-separated prelude is several rules
    // wearing one set of braces, so half of one can be dead while the other half renders.
    expect(compounds(".a > b, .c d")).toEqual([".a > b", ".c d"])
    expect(compounds("@media (max-width: 720px)")).toEqual([])
  })
})
