/**
 * The homepage hero's shuttlecock: a Yonex Mavis 350 drawn in lines, built from 66 rosette rings,
 * 16 ribs (each a pair of lines) and 64 mesh mullions, in the headline ink with the cork's tape band
 * in brand red. It starts as a flat lacy spiral and turns into the shuttle.
 *
 * This file is the geometry, the loop and the pose at any moment. It is pure and deterministic (no
 * DOM, no WebGL) so the whole loop can be checked without a browser; shuttle-renderer.ts draws it.
 *
 * Ported from the lab prototype the owner approved on 14 Nov 2026 (hero-lab/rosette-shuttle/_v5-mavis).
 * Every number is the lab's: changing one changes the approved animation.
 */

const TAU = Math.PI * 2
const DEG = Math.PI / 180

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const cubicInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
/** Sine in-out for the flat <-> 3D turns and the draw-in: short slow tails (peak 1.57x the mean speed). */
const sineInOut = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x))

/** A value that follows a target with a critically damped spring (no overshoot). */
export interface Spring {
  x: number
  v: number
}

/** One exact critically damped step toward `target`; `dt` in seconds. */
function critDamp(s: Spring, target: number, omega: number, dt: number) {
  const y = s.x - target
  const e = Math.exp(-omega * dt)
  const c = s.v + omega * y
  s.x = target + (y + c * dt) * e
  s.v = (s.v - c * omega * dt) * e
}

// ---- Geometry ---------------------------------------------------------------------------------
// Millimetres, scaled to a 25.5 mm cork, measured from the owner's photos (side view and close-up).
// y = 0 at the cork's rounded end.
export const MM = {
  corkR: 12.75,
  bandY: [17, 23.3],
  collarY: [23.5, 25.2],
  collarR: 11.2,
  ringA: 38,
  ringB: 50.2,
  meshTop: 51,
  length: 86.5,
  rimR: 32,
  pointDepth: 5.5,
} as const

/** The skirt is a straight cone: its radius (mm) at height y (mm). */
const coneR = (y: number) =>
  MM.collarR + (MM.rimR - MM.collarR) * clamp01((y - MM.collarY[0]) / (MM.length - MM.collarY[0]))

/** mm -> model units. */
const U = 1 / 43
/** Near the bounding sphere's centre (mm), so rotations stay compact. */
const CENTRE = 49
const toY = (mm: number) => (mm - CENTRE) * U
const RIBS = 16
export const RIB_OFFSET = 0.1
/** Above 1 rounds the rim's tips; the notches stay sharp. */
export const POINT_ROUND = 1.35
/** 5 mesh cells per rib gap. */
const MULLIONS = [0.2, 0.4, 0.6, 0.8]
/** A rib is a strip about 1 mm wide. */
const RIB_HALF = 0.5
const STEP = TAU / RIBS

/** The rim's 16 star points: 1 at a rib (a slightly rounded tip), 0 midway (a sharp notch). */
const pointAt = (th: number) => {
  const f = ((((th - RIB_OFFSET) / STEP) % 1) + 1) % 1
  return 1 - Math.pow(2 * Math.min(f, 1 - f), POINT_ROUND)
}
/** How far the rim points pull a mesh row (0 low in the mesh .. 1 at the rim). */
const pointPull = (y: number) => Math.pow(clamp01((y - 66) / (MM.length - 66)), 1.6)

export type RingKind = "cork" | "band" | "collar" | "tie" | "mesh" | "rim"
export type LineKind = "rib" | "mull"
export type StrokeKind = RingKind | LineKind

/** A looping sine band lying across the shuttle's axis. Lengths are model units. */
export interface Ring {
  kind: RingKind
  /** Height as the shuttle (units), and in mm from the cork's tip. */
  y: number
  ymm: number
  /** Radius as the shuttle, and as the flat rosette. */
  R: number
  rf: number
  /** Loop size across and along the ring as the shuttle, and the loop size as the flat rosette. */
  ar: number
  at: number
  far: number
  /** Loops round the ring. */
  k: number
  /** How far the rim's points pull the ring toward the cork. */
  lobe: number
}

export const RINGS: readonly Ring[] = (() => {
  const list: Omit<Ring, "rf" | "far">[] = []
  const ring = (ymm: number, r: number, kind: RingKind, ar = 0.3, at = 0.22, lobe = 0) =>
    list.push({ y: toY(ymm), ymm, R: r * U, ar: ar * U, at: at * U, k: Math.max(10, Math.round(r * 6)), kind, lobe: lobe * U })
  // cork: a dome a little taller than a hemisphere (22 rings by polar angle), then a short straight part
  for (let i = 1; i <= 22; i++) {
    const phi = (i / 22) * (Math.PI / 2)
    ring(MM.corkR - MM.corkR * Math.cos(phi), MM.corkR * Math.sin(phi), "cork")
  }
  for (const y of [13.8, 14.9, 16, 16.6]) ring(y, MM.corkR, "cork")
  // the tape band round the cork's lower part (the only red)
  for (let y = MM.bandY[0] + 0.3; y <= MM.bandY[1]; y += 0.6) ring(y, MM.corkR + 0.25, "band")
  // the collar, where the skirt seats in the cork
  for (let y = MM.collarY[0]; y <= MM.collarY[1] + 0.01; y += 0.55) ring(y, coneR(y) + 0.1, "collar", 0.15, 0.12)
  // the two moulded tie bands closing the window tiers: plain edges, small loops inside
  for (const c of [MM.ringA, MM.ringB]) {
    for (const d of [-1.2, -0.6, 0, 0.6, 1.2]) {
      const edge = Math.abs(d) > 1
      ring(c + d, coneR(c + d) + 0.1, "tie", edge ? 0.03 : 0.14, edge ? 0.02 : 0.11)
    }
  }
  // fine mesh: rows growing 3% each toward the rim; the last rows bend into the 16 star points
  let y = MM.meshTop + 1.9
  let h = 1.9
  while (y < MM.length - 1.2) {
    ring(y, coneR(y), "mesh", 0.07, 0.05, MM.pointDepth * pointPull(y))
    h *= 1.03
    y += h
  }
  // the star-pointed rim, drawn as a tight bundle
  for (const d of [-0.5, 0]) ring(MM.length + d, MM.rimR + 0.1, "rim", 0.07, 0.05, MM.pointDepth)
  list.sort((a, b) => a.y - b.y)

  // the flat rosette's bands, with gaps: cork dome, red band, collar and ties, mesh, rim
  const bandOf = (r: Omit<Ring, "rf" | "far">) =>
    r.kind === "cork" ? 0 : r.kind === "band" ? 1 : r.kind === "collar" || r.kind === "tie" ? 2 : r.kind === "mesh" ? 3 : 4
  const BANDS = [
    { r0: 0.12, r1: 0.3, far: 0.018 },
    { r0: 0.39, r1: 0.43, far: 0.03 },
    { r0: 0.52, r1: 0.59, far: 0.022 },
    { r0: 0.68, r1: 0.85, far: 0.022 },
    { r0: 0.93, r1: 0.95, far: 0.035 },
  ]
  /** The flat rosette's overall size (units). */
  const FLAT = 0.9
  const counts = [0, 0, 0, 0, 0]
  const seen = [0, 0, 0, 0, 0]
  for (const r of list) counts[bandOf(r)]++
  return list.map((r) => {
    const b = bandOf(r)
    const B = BANDS[b]
    const k = seen[b]++
    return { ...r, rf: FLAT * (counts[b] > 1 ? B.r0 + (B.r1 - B.r0) * (k / (counts[b] - 1)) : B.r0), far: B.far }
  })
})()

/** Flat radius at height ymm (between rings), for the lines that follow the turn. */
function flatRAt(ymm: number) {
  let a = RINGS[0]
  let b = RINGS[RINGS.length - 1]
  for (const r of RINGS) {
    if (r.ymm <= ymm) a = r
    if (r.ymm >= ymm) {
      b = r
      break
    }
  }
  return b.ymm === a.ymm ? a.rf : a.rf + ((b.rf - a.rf) * (ymm - a.ymm)) / (b.ymm - a.ymm)
}

/** A straight line on the cone: a rib edge (collar to rim point) or a mesh mullion (second tie to rim). */
export interface Line {
  kind: LineKind
  /** Angle round the axis (rad). */
  a0: number
  /** Offset along the circumference (units): +-half a rib's width, so a rib reads as a flat strip. */
  side: number
  /** Ends (mm). */
  y0: number
  y1: number
}

export const LINES: readonly Line[] = (() => {
  const out: Line[] = []
  const edge = (a: number) => MM.length - MM.pointDepth * (1 - pointAt(a))
  for (let j = 0; j < RIBS; j++) {
    for (const d of [-RIB_HALF, RIB_HALF]) {
      const a = RIB_OFFSET + j * STEP
      out.push({ kind: "rib", a0: a, side: d * U, y0: MM.collarY[0], y1: edge(a) })
    }
  }
  for (let j = 0; j < RIBS; j++) {
    for (const f of MULLIONS) {
      const a = RIB_OFFSET + (j + f) * STEP
      out.push({ kind: "mull", a0: a, side: 0, y0: MM.ringB + 0.8, y1: edge(a) })
    }
  }
  return out
})()

/** The resting shuttle's size: a model unit is SCALE x min(slot width, slot height) in pixels. */
export const SCALE = 0.38
/** The flat rosette draws larger (the earlier 0.48 scale); the whole object zooms between the two. */
const FLAT_ZOOM = 0.48 / SCALE

/** The floating 3/4 view: skirt up-right, cork down-left. */
const VIEW = { pitch: 16 * DEG, roll: -30 * DEG }

// ---- The loop -----------------------------------------------------------------------------------
// One loop is the FLAT BLOCK (draw-in, hold, pulse, hold, turn into the shuttle) and then, in 3D:
// rotate 3 s, pulse, rotate 2 s, somersault, rotate 3 s, pulse, rotate 2 s, then the RETURN (turn to
// flat while the spiral un-draws in exact reverse of the draw-in). The next draw-in starts the moment
// the last ring has erased, so erase -> draw is one continuous wave. The spin never stops.
const DRAW_MS = 1100
const DRAW_STAGGER = 18
/** 2270 ms: the whole spiral drawn. */
const DRAW_ALL = (RINGS.length - 1) * DRAW_STAGGER + DRAW_MS
const TURN_MS = 3600
const UNTURN_MS = 2800
const FLIP_MS = 4200
const PULSE_MS = 2800
const HOLD_MS = 1000
/** The un-draw begins when the turn to flat is 85% done (its slow end overlaps the first erasing rings). */
const UNDRAW_OVERLAP = 0.15
/** 3.27 s into the flat block. */
const FLAT_PULSE_AT = DRAW_ALL + HOLD_MS
/** 7.07 s. */
const TURN_AT = FLAT_PULSE_AT + PULSE_MS + HOLD_MS
/** 10.67 s: the shuttle is whole. */
const SHUTTLE_AT = TURN_AT + TURN_MS

type Action = "pulse" | "flip" | "return"
/** The 3D events, ms after the draw-in starts ("rotate N s" = N s from one action's end to the next's start). */
const EVENTS: readonly { at: number; act: Action }[] = (() => {
  let t = SHUTTLE_AT + 3000
  const out: { at: number; act: Action }[] = [{ at: t, act: "pulse" }]
  t += PULSE_MS + 2000
  out.push({ at: t, act: "flip" })
  t += FLIP_MS + 3000
  out.push({ at: t, act: "pulse" })
  t += PULSE_MS + 2000
  out.push({ at: t, act: "return" })
  return out
})()

/** One loop (35.12 s): the flat block to the return, the turn to flat (less its overlap), then the un-draw. */
export const LOOP_MS = EVENTS[EVENTS.length - 1].at + UNTURN_MS * (1 - UNDRAW_OVERLAP) + DRAW_ALL

/** Yaw rate when flat, as a share of the 3D rate, so the flat rim moves at the 3D rim's on-screen speed. */
const SPIN_FLAT = 0.48
/** The pulse: a wave along the shuttle's length (by position, not ring index), sin^2 in time. */
const PULSE_W = 0.16
const PULSE_R = 0.03
const PULSE_LOOPS = 0.2
/** The first-paint still: the faint flat spiral, faded out while the live rings draw over it. */
const STILL_OPACITY = 0.22

export interface ShuttleState {
  /** ms since the shuttle started. */
  t: number
  /** Start of the current (or next) draw-in. */
  drawStart: number
  /** Start of the last turn back to flat, and of the un-draw that follows it. */
  unturnStart: number
  undrawStart: number
  /** Whether this flat block's own pulse has started. */
  flatPulsed: boolean
  flipStart: number
  pulseStart: number
  /** The next entry of EVENTS in this loop. */
  nextEvent: number
  /** Integrated clocks: the yaw (rad), the loops' drift and the breathing phase. */
  spin: number
  phase: number
  breath: number
  /** The pointer tilt (fine pointers only): x and y in -1.5..1.5 of the slot's half size. */
  pointer: { x: Spring; y: Spring; on: Spring; tx: number; ty: number; active: boolean }
}

export function createState(): ShuttleState {
  const spring = (x: number): Spring => ({ x, v: 0 })
  return {
    t: 0,
    drawStart: 0,
    unturnStart: -1e9,
    undrawStart: -1e9,
    flatPulsed: false,
    flipStart: -1e9,
    pulseStart: -1e9,
    nextEvent: 0,
    spin: 0,
    phase: 0,
    breath: 0,
    pointer: { x: spring(0), y: spring(0), on: spring(0), tx: 0, ty: 0, active: false },
  }
}

/** Turn to flat and un-draw; the next draw-in starts the moment the last ring has erased. */
function returnToFlat(s: ShuttleState) {
  s.unturnStart = s.t
  s.undrawStart = s.t + UNTURN_MS * (1 - UNDRAW_OVERLAP)
  s.drawStart = s.undrawStart + DRAW_ALL
  s.flatPulsed = false
  s.nextEvent = 0
}

/** The pointer's position over the slot (x right, y up; 1 = the slot's half size), or `active: false` when it leaves. */
export function setPointer(s: ShuttleState, x: number, y: number, active: boolean) {
  s.pointer.active = active
  if (active) {
    s.pointer.tx = Math.max(-1.5, Math.min(1.5, x))
    s.pointer.ty = Math.max(-1.5, Math.min(1.5, y))
  }
}

/** E: 0 = the flat rosette face-on, 1 = the shuttle in 3/4. One curve drives the tilt, zoom, centring and spin rate. */
export function extrusion(s: ShuttleState) {
  if (s.t < s.drawStart) return 1 - sineInOut((s.t - s.unturnStart) / UNTURN_MS)
  return sineInOut((s.t - s.drawStart - TURN_AT) / TURN_MS)
}

/** Ring i's drawn share (0..1): drawn in from the centre out, un-drawn in exact reverse. */
export function ringReveal(s: ShuttleState, i: number) {
  if (s.t >= s.drawStart) return sineInOut((s.t - s.drawStart - i * DRAW_STAGGER) / DRAW_MS)
  if (s.t >= s.undrawStart) return 1 - sineInOut((s.t - s.undrawStart - (RINGS.length - 1 - i) * DRAW_STAGGER) / DRAW_MS)
  return 1
}

/** Advance the loop by dtMs. */
export function step(s: ShuttleState, dtMs: number) {
  const ms = Math.max(0, dtMs)
  const dt = ms / 1000
  s.t += ms
  const t = s.t
  // the flat block's own pulse
  if (!s.flatPulsed && t >= s.drawStart + FLAT_PULSE_AT) {
    s.flatPulsed = true
    s.pulseStart = t
  }
  if (t >= s.drawStart) {
    const next = EVENTS[s.nextEvent]
    if (next && t - s.drawStart >= next.at) {
      s.nextEvent++
      if (next.act === "pulse") s.pulseStart = t
      else if (next.act === "flip") s.flipStart = t
      else returnToFlat(s)
    }
  }
  const p = s.pointer
  critDamp(p.x, p.tx, 5, dt)
  critDamp(p.y, p.ty, 5, dt)
  critDamp(p.on, p.active ? 1 : 0, 5, dt)
  // the yaw rate eases with E, so the flat rosette turns at the 3D spin's on-screen speed;
  // the angle is integrated, so it never jumps
  s.spin += dt * 0.28 * (SPIN_FLAT + (1 - SPIN_FLAT) * extrusion(s))
  // wrap the loop drift so it never loses float precision on the GPU; 200π is a whole number of turns
  // for every ring's loop rate (1 + 0.01i), so no ring jumps
  s.phase = (s.phase + dt * 0.08) % (200 * Math.PI)
  s.breath += (dt * TAU) / 6.5
}

/** The first-paint still's opacity while the live rings draw in over it (0 once they have). */
export function firstPaintStillOpacity(tMs: number) {
  const x = clamp01((tMs - 600) / 2600)
  return STILL_OPACITY * (1 - x * x * (3 - 2 * x))
}

/** Column-major view matrix Rz(roll) * Rx(pitch) * Ry(yaw), written into `out`. */
export function view(yaw: number, pitch: number, roll: number, out: Float32Array) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll)
  const a = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
  const b = [a[0], a[1], a[2], cp * a[3] - sp * a[6], cp * a[4] - sp * a[7], cp * a[5] - sp * a[8], sp * a[3] + cp * a[6], sp * a[4] + cp * a[7], sp * a[5] + cp * a[8]]
  const m = [cr * b[0] - sr * b[3], cr * b[1] - sr * b[4], cr * b[2] - sr * b[5], sr * b[0] + cr * b[3], sr * b[1] + cr * b[4], sr * b[2] + cr * b[5], b[6], b[7], b[8]]
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[j * 3 + i] = m[i * 3 + j]
  return out
}

export interface RingPose {
  R: number
  y: number
  /** Loop size multiplier. */
  am: number
  lobe: number
  reveal: number
}

export interface LinePose {
  r0: number
  r1: number
  y0: number
  y1: number
}

export interface Pose {
  E: number
  yaw: number
  pitch: number
  roll: number
  rings: RingPose[]
  lines: LinePose[]
  zoom: number
  /** The pulse wave along the shuttle's length: centre and width (0..1 of the length) and radius swell. */
  pulse: { c: number; w: number; a: number }
  /** The centring offset (units, after rotation). */
  ox: number
  oy: number
}

/** The whole drawing at the state's moment: per-ring and per-line geometry and the view. */
export function pose(s: ShuttleState): Pose {
  const E = extrusion(s)
  const t = s.t / 1000
  const q = s.pointer
  const fx = clamp01((s.t - s.flipStart) / FLIP_MS)
  // one slow turnover, cork leading
  const flipA = fx > 0 && fx < 1 ? cubicInOut(fx) * TAU : 0
  const float = Math.sin(t * 0.37) * 3 * DEG + Math.sin(t * 0.23 + 1) * 2 * DEG
  const pitch = 90 * DEG + (VIEW.pitch - 90 * DEG) * E + flipA + float * E - q.y.x * 5 * DEG * q.on.x
  const roll = VIEW.roll * E + Math.sin(t * 0.29 + 0.4) * 2.5 * DEG * E
  const yaw = s.spin + q.x.x * 5 * DEG * q.on.x
  // the pulse travels the shuttle's length (by position in mm, not ring index: most rings sit in the cork),
  // wide and sin^2 in time; the ribs and mullions swell with it in the shader, so nothing detaches
  const pt = (s.t - s.pulseStart) / PULSE_MS
  const pulseAmp = pt > 0 && pt < 1 ? Math.pow(Math.sin(Math.PI * pt), 2) : 0
  const pulseC = -0.3 + 1.6 * clamp01(pt)
  const pulseAt = (yn: number) => pulseAmp * Math.exp(-Math.pow((yn - pulseC) / PULSE_W, 2))
  // flat stays breathe a little more (never frozen)
  const flat = 1 - E
  const rings = RINGS.map((r, i): RingPose => {
    const yn = r.ymm / MM.length
    const br = Math.sin(s.breath - yn * 5.5)
    const pw = pulseAt(yn)
    return {
      R: (r.rf + (r.R - r.rf) * E) * (1 + (0.008 + 0.012 * flat) * br + PULSE_R * pw),
      y: r.y * E,
      am: (r.far / r.ar + (1 - r.far / r.ar) * E) * (1 + (0.06 + 0.12 * flat) * br + PULSE_LOOPS * pw),
      lobe: r.lobe * E,
      reveal: ringReveal(s, i),
    }
  })
  const lines = LINES.map((l): LinePose => ({
    r0: flatRAt(l.y0) + (coneR(l.y0) * U - flatRAt(l.y0)) * E,
    r1: flatRAt(l.y1) + (coneR(l.y1) * U - flatRAt(l.y1)) * E,
    y0: toY(l.y0) * E,
    y1: toY(l.y1) * E,
  }))
  // Keep the drawing centred in the slot. The centre is measured on the RESTING 3D pose (true shape, no
  // somersault, current sway and pointer tilt), carried to the flat centre (0) by E, the same curve as the
  // tilt and zoom, so the object glides as one. Mid-somersault the offset eases to 0, so the shuttle
  // tumbles about its own centre with no frame-to-frame jumps.
  const pitch3 = VIEW.pitch + float - q.y.x * 5 * DEG * q.on.x
  const roll3 = VIEW.roll + Math.sin(t * 0.29 + 0.4) * 2.5 * DEG
  const [cx, cy] = boxCentre(yaw, pitch3, roll3)
  const held = 1 - Math.pow(Math.sin(Math.PI * fx), 2)
  // one uniform scale of the whole object on the transition's own curve: larger flat, SCALE as the shuttle
  const zoom = (1 + (FLAT_ZOOM - 1) * (1 - E)) * (1 + 0.015 * flat * Math.sin(s.breath))
  return {
    E, yaw, pitch, roll, rings, lines, zoom,
    pulse: { c: pulseC, w: PULSE_W, a: PULSE_R * pulseAmp },
    ox: -cx * E * zoom * held,
    oy: -cy * E * zoom * held,
  }
}

const BOX_VIEW = new Float32Array(9)
/** Every 4th ring and the last: enough to bound the shuttle. */
const BOX_RINGS = RINGS.filter((_, i) => i % 4 === 0 || i === RINGS.length - 1)

/**
 * Centre of the shuttle's projected bounding box (units), from the rings' projected ellipses at their
 * true sizes (no breathing or pulse). Smooth under spin: a ring's ellipse doesn't change as it turns
 * about its own axis.
 */
function boxCentre(yaw: number, pitch: number, roll: number): [number, number] {
  const m = view(yaw, pitch, roll, BOX_VIEW)
  const ax = Math.hypot(m[0], m[6])
  const ay = Math.hypot(m[1], m[7])
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9
  for (const g of BOX_RINGS) {
    for (const y of g.lobe ? [g.y, g.y - g.lobe] : [g.y]) {
      const k = 6 / (6 - m[5] * y)
      const cx = m[3] * y
      const cy = m[4] * y
      x0 = Math.min(x0, (cx - g.R * ax) * k)
      x1 = Math.max(x1, (cx + g.R * ax) * k)
      y0 = Math.min(y0, (cy - g.R * ay) * k)
      y1 = Math.max(y1, (cy + g.R * ay) * k)
    }
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2]
}

// ---- Stroke style ------------------------------------------------------------------------------
export interface StrokeStyle {
  alpha: number
  /** Width in px at the reference size (the renderer scales it with the drawing). */
  width: number
  /** How much edge-on stretches soften: airy skirt, solid cork. */
  edge: number
  /** The only colour is the cork's tape band; everything else is ink. */
  color: "ink" | "red"
}

const STYLES: Record<StrokeKind, Omit<StrokeStyle, "color">> = {
  cork: { alpha: 0.78, width: 0.7, edge: 0.2 },
  band: { alpha: 0.95, width: 0.85, edge: 0.2 },
  collar: { alpha: 0.85, width: 0.8, edge: 0.35 },
  tie: { alpha: 0.85, width: 0.8, edge: 0.5 },
  mesh: { alpha: 0.72, width: 0.6, edge: 0.7 },
  rim: { alpha: 0.9, width: 0.95, edge: 0.45 },
  rib: { alpha: 0.9, width: 1.0, edge: 0.35 },
  mull: { alpha: 0.65, width: 0.55, edge: 0.6 },
}

export function strokeStyle(kind: StrokeKind): StrokeStyle {
  return { ...STYLES[kind], color: kind === "band" ? "red" : "ink" }
}

/** The flat rosette's weights: the dense cork lighter, mesh rows a little stronger, the lines hidden. */
export const flatAlpha = (kind: StrokeKind, E: number) =>
  kind === "rib" || kind === "mull"
    ? clamp01((E - 0.35) / 0.5)
    : kind === "cork" ? 0.5 + 0.5 * E : kind === "mesh" ? 1.25 - 0.25 * E : 0.72 + 0.28 * E
