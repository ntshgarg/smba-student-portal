import { describe, expect, it } from "vitest"

import { ACADEMY, BWF_EVENTS, tournamentRings } from "@/components/public/hero-shuttle/tournament-rings"

describe("tournament watermark rings", () => {
  const rings = tournamentRings()

  it("packs the rings tightly from the shuttle outward", () => {
    expect(rings.length).toBeGreaterThanOrEqual(60)
    for (let i = 1; i < rings.length; i++) {
      expect(rings[i].r - rings[i - 1].r).toBeCloseTo(rings[1].r - rings[0].r, 6)
    }
  })

  it("carries the academy on the innermost ring only, in whole repeats", () => {
    expect(rings[0].text.split(" · ").filter(Boolean)).toEqual(
      expect.arrayContaining(ACADEMY.split(" · ")),
    )
    expect(rings[0].text.replaceAll(`${ACADEMY} · `, "")).toBe("")
    expect(rings.slice(1).some((ring) => ring.text.includes("Sathiya"))).toBe(false)
  })

  it("names every BWF event somewhere, and only those, never cut at a ring's seam", () => {
    const named = new Set(rings.slice(1).flatMap((ring) => ring.text.split(" · ").filter(Boolean)))
    expect([...named].sort()).toEqual([...BWF_EVENTS].sort())
    for (const ring of rings) expect(ring.text.endsWith(" · ")).toBe(true)
  })

  it("fills each ring to about its circumference, so the spacing adjustment stays small", () => {
    for (const ring of rings.slice(1)) {
      const circumference = 2 * Math.PI * ring.r
      const estimate = ring.text.length * (10.4 * 0.4 + 0.3)
      expect(estimate / circumference).toBeGreaterThan(0.8)
      expect(estimate / circumference).toBeLessThan(1.2)
    }
  })

  it("is the same on every render", () => {
    expect(tournamentRings()).toEqual(rings)
  })
})
