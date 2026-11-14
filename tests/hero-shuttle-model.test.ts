import { describe, expect, it } from "vitest"

import {
  LINES,
  LOOP_MS,
  MM,
  POINT_ROUND,
  RIB_OFFSET,
  RINGS,
  SCALE,
  createState,
  extrusion,
  firstPaintStillOpacity,
  pose,
  ringReveal,
  step,
  view,
  type Pose,
  type ShuttleState,
} from "@/components/public/hero-shuttle/shuttle-model"

const FRAME_MS = 1000 / 60
const TAU = Math.PI * 2

/** Step a fresh state in fixed frames, calling `each` after every step. */
function play(totalMs: number, frameMs: number, each: (s: ShuttleState) => void) {
  const s = createState()
  for (let t = 0; t < totalMs; t += frameMs) {
    step(s, frameMs)
    each(s)
  }
  return s
}

/** Screen position (px, y up) of model point p in a slot whose drawing unit is `unitPx`: what the vertex shader does. */
function project(ps: Pose, p: number[], unitPx: number) {
  const m = view(ps.yaw, ps.pitch, ps.roll, new Float32Array(9))
  const x = (m[0] * p[0] + m[3] * p[1] + m[6] * p[2]) * ps.zoom + ps.ox
  const y = (m[1] * p[0] + m[4] * p[1] + m[7] * p[2]) * ps.zoom + ps.oy
  const z = (m[2] * p[0] + m[5] * p[1] + m[8] * p[2]) * ps.zoom
  const k = 6 / (6 - z)
  return [x * k * unitPx, y * k * unitPx]
}

// JS twins of curve() in shuttle-renderer.ts (CURVE_GLSL), for the framing check.
function ringPoint(ps: Pose, i: number, s: number, phase: number) {
  const r = RINGS[i]
  const g = ps.rings[i]
  const th = TAU * s
  const psi = r.k * th + phase * (1 + 0.01 * i) + i * 1.7
  const f = ((((th - RIB_OFFSET) / (TAU / 16)) % 1) + 1) % 1
  const l = 1 - Math.pow(2 * Math.min(f, 1 - f), POINT_ROUND)
  const rad = g.R + r.ar * g.am * Math.cos(psi)
  const tg = r.at * g.am * Math.sin(psi + 0.6)
  return [rad * Math.cos(th) - tg * Math.sin(th), g.y - g.lobe * (1 - l), rad * Math.sin(th) + tg * Math.cos(th)]
}
function linePoint(ps: Pose, j: number, s: number) {
  const l = LINES[j]
  const g = ps.lines[j]
  const yn = (l.y0 + (l.y1 - l.y0) * s) / MM.length
  const r = (g.r0 + (g.r1 - g.r0) * s) * (1 + ps.pulse.a * Math.exp(-Math.pow((yn - ps.pulse.c) / ps.pulse.w, 2)))
  const a = l.a0 + l.side / Math.max(r, 0.004)
  return [Math.cos(a) * r, g.y0 + (g.y1 - g.y0) * s, Math.sin(a) * r]
}

describe("hero shuttle model", () => {
  it("builds the approved Mavis 350: 66 rings, 32 rib edges and 64 mullions", () => {
    expect(RINGS).toHaveLength(66)
    expect(LINES.filter((l) => l.kind === "rib")).toHaveLength(32)
    expect(LINES.filter((l) => l.kind === "mull")).toHaveLength(64)
    expect(RINGS.filter((r) => r.kind === "band").length).toBeGreaterThan(0)
    // rings run cork to rim, so the draw-in goes centre out and the un-draw rim first
    for (let i = 1; i < RINGS.length; i++) expect(RINGS[i].ymm).toBeGreaterThanOrEqual(RINGS[i - 1].ymm)
  })

  it("runs the approved 35.12 s loop in order", () => {
    // ms from the start of a draw-in
    const DRAW = 2270
    const loop = [
      { event: "flat pulse", at: DRAW + 1000 },
      { event: "turn into the shuttle", at: 7070 },
      { event: "shuttle whole", at: 10_670 },
      { event: "pulse", at: 10_670 + 3000 },
      { event: "somersault", at: 13_670 + 2800 + 2000 },
      { event: "pulse", at: 18_470 + 4200 + 3000 },
      { event: "turn back to flat", at: 25_670 + 2800 + 2000 },
      { event: "un-draw", at: 30_470 + 2800 * 0.85 },
      { event: "next draw-in", at: 32_850 + DRAW },
    ]
    expect(LOOP_MS).toBe(35_120)
    expect(loop.at(-1)?.at).toBe(LOOP_MS)

    const seen: { event: string; at: number }[] = []
    let last = createState()
    let wasWhole = false
    let wasTurning = false
    play(2 * LOOP_MS + 1000, 1, (s) => {
      const E = extrusion(s)
      if (s.pulseStart !== last.pulseStart) seen.push({ event: s.flatPulsed && !last.flatPulsed ? "flat pulse" : "pulse", at: s.t })
      if (s.flipStart !== last.flipStart) seen.push({ event: "somersault", at: s.t })
      if (s.unturnStart !== last.unturnStart) seen.push({ event: "turn back to flat", at: s.t })
      if (s.t === s.undrawStart) seen.push({ event: "un-draw", at: s.t })
      if (s.t === s.drawStart && s.t > 0) seen.push({ event: "next draw-in", at: s.t })
      if (E > 0 && !wasTurning && s.t >= s.drawStart) seen.push({ event: "turn into the shuttle", at: s.t - 1 })
      if (E === 1 && !wasWhole) seen.push({ event: "shuttle whole", at: s.t })
      wasTurning = E > 0
      wasWhole = E === 1
      last = structuredClone(s)
    })

    const expected = [...loop, ...loop.map(({ event, at }) => ({ event, at: at + LOOP_MS }))]
    expect(seen.slice(0, expected.length)).toEqual(expected)
  })

  it("draws the spiral in from the centre and un-draws it in exact reverse", () => {
    const s = createState()
    expect(RINGS.map((_, i) => ringReveal(s, i)).every((r) => r === 0)).toBe(true)
    step(s, 2270)
    expect(RINGS.map((_, i) => ringReveal(s, i)).every((r) => r === 1)).toBe(true)

    const later = createState()
    for (let t = 0; t < 33_500; t += 10) step(later, 10)
    // 650 ms into the un-draw: the rim has started erasing, the cork has not
    expect(ringReveal(later, RINGS.length - 1)).toBeLessThan(1)
    expect(ringReveal(later, 0)).toBe(1)
    expect(extrusion(later)).toBeLessThan(0.05)
  })

  it("moves with no jumps in position or speed across two loops at 60 fps", () => {
    const unitPx = SCALE * 633.6 // the 1440 x 900 slot
    const refs = [0, 20, 33, 45, RINGS.length - 1].flatMap((i) => [0, 1.3, 2.9, 4.4].map((th) => ({ i, th })))
    let prev: number[][] | null = null
    let prevMove: number[][] | null = null
    let prevReveal: number[] | null = null
    let prevE = 0
    let maxMove = 0
    let maxSpeedChange = 0
    let maxRevealStep = 0
    let maxEStep = 0
    play(2 * LOOP_MS + 2000, FRAME_MS, (s) => {
      const ps = pose(s)
      const points = refs.map(({ i, th }) => {
        const g = ps.rings[i]
        return project(ps, [g.R * Math.cos(th), g.y, g.R * Math.sin(th)], unitPx)
      })
      const reveal = RINGS.map((_, i) => ringReveal(s, i))
      if (prev && prevReveal) {
        const move = points.map((p, j) => [p[0] - prev![j][0], p[1] - prev![j][1]])
        for (const v of move) maxMove = Math.max(maxMove, Math.hypot(v[0], v[1]))
        if (prevMove) move.forEach((v, j) => {
          maxSpeedChange = Math.max(maxSpeedChange, Math.hypot(v[0] - prevMove![j][0], v[1] - prevMove![j][1]))
        })
        prevMove = move
        reveal.forEach((r, i) => { maxRevealStep = Math.max(maxRevealStep, Math.abs(r - prevReveal![i])) })
        maxEStep = Math.max(maxEStep, Math.abs(ps.E - prevE))
      }
      prev = points
      prevReveal = reveal
      prevE = ps.E
    })
    // measured on the approved loop: 19.3 px, 1.77 px, 0.0238 and 0.0093
    expect(maxMove).toBeLessThan(22)
    expect(maxSpeedChange).toBeLessThan(2.5)
    expect(maxRevealStep).toBeLessThan(0.025)
    expect(maxEStep).toBeLessThan(0.01)
  })

  it("stays inside the slot through a whole loop at every landscape size", () => {
    // slot sizes (px) measured on the live hero
    const slots = {
      "901x800": [405, 715], "1024x768": [460.8, 683], "1440x900": [633.6, 815], "2560x1440": [1126.4, 1355],
      // short laptop windows: the hero is as tall as the screen below the header, or its copy
      "1366x657": [601, 595], "1920x620": [845, 621], "901x480": [405, 573],
    }
    const tightest: Record<string, number> = {}
    play(LOOP_MS + 1000, 50, (s) => {
      const ps = pose(s)
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      const add = (p: number[]) => {
        const [x, y] = project(ps, p, 1)
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      }
      RINGS.forEach((_, i) => { for (let k = 0; k < 96; k++) add(ringPoint(ps, i, k / 96, s.phase)) })
      LINES.forEach((_, j) => { for (const k of [0, 0.5, 1]) add(linePoint(ps, j, k)) })
      for (const [name, [w, h]] of Object.entries(slots)) {
        const unit = SCALE * Math.min(w, h)
        const margin = Math.min(w / 2 + x0 * unit, w / 2 - x1 * unit, h / 2 + y0 * unit, h / 2 - y1 * unit)
        tightest[name] = Math.min(tightest[name] ?? Infinity, margin)
      }
    })
    for (const [name, margin] of Object.entries(tightest)) expect(margin, name).toBeGreaterThan(20)
  })

  it("is deterministic: the same steps give the same drawing, and posing changes nothing", () => {
    const a = play(20_000, FRAME_MS, () => {})
    const b = play(20_000, FRAME_MS, () => {})
    expect(pose(a)).toEqual(pose(b))
    const before = structuredClone(a)
    pose(a)
    expect(a).toEqual(before)
  })

  it("fades the first-paint still out while the rings draw in", () => {
    expect(firstPaintStillOpacity(0)).toBeCloseTo(0.22)
    expect(firstPaintStillOpacity(600)).toBeCloseTo(0.22)
    expect(firstPaintStillOpacity(1900)).toBeCloseTo(0.11)
    expect(firstPaintStillOpacity(3200)).toBe(0)
    expect(firstPaintStillOpacity(60_000)).toBe(0)
  })
})
