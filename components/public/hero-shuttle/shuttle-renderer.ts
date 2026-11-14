/**
 * Draws the hero shuttlecock (shuttle-model.ts) with WebGL2: anti-aliased strokes of analytic curves.
 *
 * The vertex shader evaluates each ring or line at s and its neighbours, projects them, and pushes each
 * vertex out along the screen-space normal, so lines keep an exact pixel width at any size or tilt. No
 * vertex buffers: one TRIANGLE_STRIP per stroke. Premultiplied "over" blending, so crossings darken like
 * ink on paper.
 *
 * It owns the loop: it pauses off screen and in a hidden tab, caps the pixel ratio (and lowers it if
 * frames run long), survives a lost context, and tears everything down in destroy(). It is loaded only
 * when the shuttle is on screen and motion is allowed (hero-shuttle.tsx).
 *
 * Ported from the approved lab prototype (hero-lab/rosette-shuttle/_v5-mavis/ribbon.js).
 */
import {
  LINES,
  MM,
  POINT_ROUND,
  RIB_OFFSET,
  RINGS,
  SCALE,
  createState,
  firstPaintStillOpacity,
  flatAlpha,
  pose,
  setPointer,
  step,
  strokeStyle,
  view,
  type StrokeKind,
  type StrokeStyle,
} from "./shuttle-model"

// A ring (uB.w <= 0): uA = (R, ar, at, k), uB = (loop amp, phase, y, -edge softening), uC = (index, -, rim-point pull, rib offset).
// A line (uB.w = 1):  uA = (angle, R0, R1, side offset), uB = (y0, y1, edge softening, 1), uC = (y0, y1 as shares of the length).
const CURVE_GLSL = /* glsl */ `
float strokeFade(float s) {
  float edge = uB.w > 0.5 ? uB.z : -uB.w;
  vec3 t;
  if (uB.w > 0.5) {
    // a line's own direction on the cone (rib or mullion)
    float r = mix(uA.y, uA.z, s);
    float a = uA.x + uA.w / max(r, 0.004);
    vec3 d = vec3(cos(a) * (uA.z - uA.y), uB.y - uB.x, sin(a) * (uA.z - uA.y));
    t = uM * normalize(d + 1e-6);
  } else {
    float th = 6.2831853 * s;
    t = uM * vec3(-sin(th), 0.0, cos(th));
  }
  return 1.0 - edge * smoothstep(0.45, 0.97, abs(t.z));
}
vec3 curve(float s) {
  if (uB.w > 0.5) {
    float r = mix(uA.y, uA.z, s);
    // the pulse wave (uPulse = centre, width, swell along the shuttle's length)
    float pd = (mix(uC.x, uC.y, s) - uPulse.x) / uPulse.y;
    r *= 1.0 + uPulse.z * exp(-pd * pd);
    float a = uA.x + uA.w / max(r, 0.004);
    return vec3(cos(a) * r, mix(uB.x, uB.y, s), sin(a) * r);
  }
  float th = 6.2831853 * s;
  float i = uC.x;
  float psi = uA.w * th + uB.y * (1.0 + 0.01 * i) + i * 1.7;
  // 16 star points: 1 at a rib (slightly rounded tip), 0 midway (sharp notch)
  float f = fract((th - uC.w) / 0.39269908);
  float l = 1.0 - pow(2.0 * min(f, 1.0 - f), ${POINT_ROUND.toFixed(3)});
  float rad = uA.x + uA.y * uB.x * cos(psi);
  float tg = uA.z * uB.x * sin(psi + 0.6);
  vec2 e = vec2(cos(th), sin(th));
  return vec3(rad * e.x - tg * e.y, uB.z - uC.z * (1.0 - l), rad * e.y + tg * e.x);
}
`

const VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;
uniform float uN, uClosed, uWidth, uAlpha, uDpr;
uniform vec4 uA, uB, uC;
uniform vec3 uPulse;
uniform vec2 uOffset;  // the centring offset, after rotation
uniform mat3 uM;
uniform vec2 uScale;   // clip units per model unit
uniform vec2 uPx;      // drawing buffer size, device px
out float vSide;
out float vHW;
out float vS;
out float vA;
${CURVE_GLSL}
vec3 proj(vec3 p) {
  vec3 v = uM * p + vec3(uOffset, 0.0);
  float k = 6.0 / (6.0 - v.z);   // focal 6: gentle perspective for a large, close object
  return vec3(v.xy * k * uScale, v.z);
}
void main() {
  int id = gl_VertexID;
  int i = id >> 1;
  float side = (id & 1) == 0 ? -1.0 : 1.0;
  float h = 1.0 / uN;
  float s = float(i) * h;
  float sa = uClosed > 0.5 ? s - h : max(s - h, 0.0);
  float sb = uClosed > 0.5 ? s + h : min(s + h, 1.0);
  vec3 P = proj(curve(s));
  vec3 A = proj(curve(sa));
  vec3 B = proj(curve(sb));
  vec2 tp = (B.xy - A.xy) * uPx * 0.5;
  float L = length(tp);
  vec2 t = L > 1e-6 ? tp / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-t.y, t.x);
  float dz = clamp(P.z * 0.8 + 0.5, 0.0, 1.0);
  // depth: back strokes thinner and lighter, front strokes a touch heavier;
  // strokeFade softens strokes seen edge-on
  float sf = strokeFade(s);
  float hw = max(uWidth * 0.5 * uDpr * mix(0.7, 1.12, dz) * mix(0.55, 1.0, sf), 0.5);
  float ext = hw + 1.0;
  gl_Position = vec4(P.xy + nrm * ext * side / (uPx * 0.5), 0.0, 1.0);
  vSide = side * ext;
  vHW = hw;
  vS = s;
  vA = uAlpha * mix(0.42, 1.12, dz) * min(1.0, uWidth * uDpr) * sf;
}
`

const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;
uniform vec3 uColor;
uniform float uReveal;
in float vSide;
in float vHW;
in float vS;
in float vA;
out vec4 o;
void main() {
  if (vS > uReveal) discard;
  float cov = clamp(vHW + 0.5 - abs(vSide), 0.0, 1.0);
  float a = vA * cov;
  o = vec4(uColor * a, a);
}
`

const UNIFORMS = ["uN", "uClosed", "uWidth", "uAlpha", "uDpr", "uA", "uB", "uC", "uPulse", "uOffset", "uM", "uScale", "uPx", "uColor", "uReveal"] as const
type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>

interface Strand {
  ring: boolean
  index: number
  kind: StrokeKind
  /** Segments along the stroke. */
  n: number
  style: StrokeStyle
}

/** Rings (closed) then lines (open). */
const STRANDS: readonly Strand[] = [
  ...RINGS.map((r, index) => ({ ring: true, index, kind: r.kind, n: Math.ceil(r.k * 16), style: strokeStyle(r.kind) })),
  ...LINES.map((l, index) => ({ ring: false, index, kind: l.kind, n: l.kind === "rib" ? 40 : 64, style: strokeStyle(l.kind) })),
]

export interface ShuttleRenderer {
  destroy(): void
}

export interface ShuttleRendererOptions {
  /** The first-paint still, faded out while the live rings draw in over it. */
  still?: HTMLElement | null
  /** Where a fine pointer gently tilts the shuttle. */
  pointerArea?: Element | null
}

/** A colour token from the stylesheet (a #rrggbb custom property) as 0..1 channels. */
function tokenColor(el: Element, name: string): [number, number, number] {
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1]
  if (!hex) throw new Error(`${name} is not a #rrggbb colour: "${value}"`)
  const n = parseInt(hex, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function compile(gl: WebGL2RenderingContext) {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)
    if (!s) throw new Error("hero shuttle: no shader")
    gl.shaderSource(s, source)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(`hero shuttle shader: ${gl.getShaderInfoLog(s)}`)
    }
    return s
  }
  const program = gl.createProgram()
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX_SHADER))
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`hero shuttle link: ${gl.getProgramInfoLog(program)}`)
  }
  const loc = Object.fromEntries(UNIFORMS.map((u) => [u, gl.getUniformLocation(program, u)])) as Uniforms
  const vao = gl.createVertexArray()
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.clearColor(0, 0, 0, 0)
  return { program, loc, vao }
}

/**
 * Start the live shuttle in `host` (the hero's visual slot): appends its canvas and runs the loop.
 * Returns null when WebGL2 is unavailable, so the still stays.
 */
export function startShuttle(host: HTMLElement, options: ShuttleRendererOptions = {}): ShuttleRenderer | null {
  const { still, pointerArea } = options
  const canvas = document.createElement("canvas")
  canvas.className = "hero-shuttle-canvas"
  const context = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    // a decorative loop must not wake a laptop's second, power-hungry GPU
    powerPreference: "low-power",
  })
  if (!context) return null
  const gl = context
  let ink: Float32Array
  let red: Float32Array
  let gpu: ReturnType<typeof compile>
  try {
    ink = new Float32Array(tokenColor(host, "--ink"))
    red = new Float32Array(tokenColor(host, "--red"))
    gpu = compile(gl)
  } catch {
    // treat a failed setup like having no WebGL2: the still stays, at full strength
    gl.getExtension("WEBGL_lose_context")?.loseContext()
    return null
  }
  host.appendChild(canvas)

  const coarse = matchMedia("(pointer: coarse)").matches || innerWidth < 1024
  const dprCap = coarse ? 1.5 : 2
  let govScale = 1
  let dpr = 1
  let W = 1
  let H = 1
  let unitPx = 1
  const state = createState()
  const M = new Float32Array(9)
  let stillOpacity = -1
  let running = false
  let raf = 0
  let last = 0
  const paused = { offscreen: false, hidden: document.hidden, lost: false, stopped: false }

  function resize(redraw = true) {
    const w = host.clientWidth
    const h = host.clientHeight
    if (!w || !h) return
    W = w
    H = h
    const deviceRatio = devicePixelRatio || 1
    // at most ~3.5 million pixels (a 2x screen at 2560 wide would otherwise be 6), never coarser than
    // one pixel per CSS pixel when the screen has that many
    dpr = Math.max(
      Math.min(deviceRatio, 1),
      Math.min(deviceRatio, dprCap, Math.sqrt(3.5e6 / (w * h))) * govScale,
    )
    const cw = Math.max(1, Math.round(w * dpr))
    const ch = Math.max(1, Math.round(h * dpr))
    const changed = canvas.width !== cw || canvas.height !== ch
    if (changed) {
      canvas.width = cw
      canvas.height = ch
    }
    unitPx = SCALE * Math.min(w, h)
    // resizing clears the drawing buffer, and the observer fires after this frame's draw: redraw now,
    // or the frame shows blank while a window is being resized
    if (redraw && (changed || !running)) draw()
  }

  function draw() {
    if (gl.isContextLost()) return
    const ps = pose(state)
    view(ps.yaw, ps.pitch, ps.roll, M)
    for (let i = 0; i < 9; i++) M[i] *= ps.zoom
    const { program, loc, vao } = gpu
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)
    gl.bindVertexArray(vao)
    gl.uniform3f(loc.uPulse, ps.pulse.c, ps.pulse.w, ps.pulse.a)
    gl.uniform2f(loc.uOffset, ps.ox, ps.oy)
    gl.uniformMatrix3fv(loc.uM, false, M)
    gl.uniform2f(loc.uScale, (2 * unitPx) / W, (2 * unitPx) / H)
    gl.uniform2f(loc.uPx, canvas.width, canvas.height)
    gl.uniform1f(loc.uDpr, dpr)
    // stroke weight follows the drawing's size: 1x at a 280px radius, within 0.85..1.6
    const wk = Math.min(1.6, Math.max(0.85, unitPx / 280))
    for (const S of STRANDS) {
      const alpha = S.style.alpha * flatAlpha(S.kind, ps.E)
      const reveal = S.ring ? ps.rings[S.index].reveal : 1
      if (alpha <= 0 || reveal <= 0) continue
      if (S.ring) {
        const r = RINGS[S.index]
        const g = ps.rings[S.index]
        gl.uniform4f(loc.uA, g.R, r.ar, r.at, r.k)
        gl.uniform4f(loc.uB, g.am, state.phase, g.y, -S.style.edge)
        gl.uniform4f(loc.uC, S.index, 0, g.lobe, RIB_OFFSET)
      } else {
        const l = LINES[S.index]
        const g = ps.lines[S.index]
        gl.uniform4f(loc.uA, l.a0, g.r0, g.r1, l.side)
        gl.uniform4f(loc.uB, g.y0, g.y1, S.style.edge, 1)
        gl.uniform4f(loc.uC, l.y0 / MM.length, l.y1 / MM.length, 0, 0)
      }
      gl.uniform1f(loc.uN, S.n)
      gl.uniform1f(loc.uClosed, S.ring ? 1 : 0)
      gl.uniform3fv(loc.uColor, S.style.color === "red" ? red : ink)
      gl.uniform1f(loc.uAlpha, alpha)
      gl.uniform1f(loc.uWidth, S.style.width * wk)
      gl.uniform1f(loc.uReveal, reveal >= 1 ? 2 : reveal)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 2 * (S.n + 1))
    }
    gl.bindVertexArray(null)
    // the faint first-paint spiral hands over to the live rings as they draw in
    if (still && stillOpacity !== 0) {
      const o = firstPaintStillOpacity(state.t)
      if (o !== stillOpacity) {
        still.style.opacity = String(o)
        stillOpacity = o
      }
    }
  }

  // If frames keep arriving much later than this screen's own pace (learnt in the first second, so a
  // browser that caps frames at 30 to save power doesn't count) for 2 s, draw at a lower resolution,
  // twice at most.
  const gov = { ema: 16.7, over: 0, warm: 0, warmFrames: 0, pace: 16.7, level: 0 }
  function governor(ms: number) {
    if (ms > 120) return
    if (gov.warm < 1000) {
      gov.warm += ms
      gov.warmFrames++
      gov.pace = gov.warm / gov.warmFrames
      gov.ema = gov.pace
      return
    }
    gov.ema += (ms - gov.ema) * 0.1
    gov.over = gov.ema > Math.max(20, gov.pace * 1.25) ? gov.over + ms : 0
    if (gov.over < 2000 || gov.level >= 2) return
    gov.level++
    gov.over = 0
    govScale = gov.level === 1 ? 0.75 : 0.55
    // this frame's draw follows straight after
    resize(false)
  }

  function tick(now: number) {
    raf = requestAnimationFrame(tick)
    // the motion is slow, so a screen faster than about 105 Hz draws every other frame: 60 to 80 fps
    // looks the same at half the work. Slower screens (75, 90, 100 Hz) draw every frame.
    if (last && now - last < 9.5) return
    const ms = last ? now - last : 16.7
    last = now
    governor(ms)
    step(state, Math.min(ms, 50))
    draw()
  }
  function sync() {
    const go = !paused.offscreen && !paused.hidden && !paused.lost && !paused.stopped
    if (go && !running) {
      running = true
      last = 0
      gov.warm = 0
      gov.warmFrames = 0
      raf = requestAnimationFrame(tick)
    } else if (!go && running) {
      running = false
      cancelAnimationFrame(raf)
    }
  }

  const resizeObserver = new ResizeObserver(() => resize())
  // the box in device pixels also changes when the window moves to a screen with another pixel ratio;
  // browsers that can't watch it watch the plain box
  try {
    resizeObserver.observe(host, { box: "device-pixel-content-box" })
  } catch {
    resizeObserver.observe(host)
  }
  const intersectionObserver = new IntersectionObserver((entries) => {
    paused.offscreen = !entries[entries.length - 1].isIntersecting
    sync()
  })
  intersectionObserver.observe(host)
  const onVisibility = () => {
    paused.hidden = document.hidden
    sync()
  }
  document.addEventListener("visibilitychange", onVisibility)
  const onContextLost = (event: Event) => {
    event.preventDefault()
    paused.lost = true
    // the canvas is blank until the context comes back, if it ever does: show the still at full strength,
    // as with no WebGL2. The first frame after a restore hands over to the live drawing again.
    still?.style.setProperty("opacity", "1")
    stillOpacity = -1
    sync()
  }
  const onContextRestored = () => {
    try {
      gpu = compile(gl)
    } catch {
      return
    }
    paused.lost = false
    draw()
    sync()
  }
  canvas.addEventListener("webglcontextlost", onContextLost)
  canvas.addEventListener("webglcontextrestored", onContextRestored)

  // a gentle tilt toward a mouse or pen; touch never tilts it
  const tiltsWithPointer = pointerArea && matchMedia("(pointer: fine)").matches
  const onPointerMove = (event: Event) => {
    const e = event as PointerEvent
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return
    const r = host.getBoundingClientRect()
    const half = Math.min(r.width, r.height) / 2
    setPointer(state, (e.clientX - (r.left + r.width / 2)) / half, -(e.clientY - (r.top + r.height / 2)) / half, true)
  }
  const onPointerLeave = () => setPointer(state, 0, 0, false)
  if (tiltsWithPointer) {
    pointerArea.addEventListener("pointermove", onPointerMove, { passive: true })
    pointerArea.addEventListener("pointerleave", onPointerLeave, { passive: true })
  }

  resize()
  sync()

  return {
    destroy() {
      paused.stopped = true
      sync()
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      canvas.removeEventListener("webglcontextlost", onContextLost)
      canvas.removeEventListener("webglcontextrestored", onContextRestored)
      if (tiltsWithPointer) {
        pointerArea.removeEventListener("pointermove", onPointerMove)
        pointerArea.removeEventListener("pointerleave", onPointerLeave)
      }
      // free the GPU memory now rather than whenever the canvas is collected
      gl.getExtension("WEBGL_lose_context")?.loseContext()
      canvas.remove()
    },
  }
}
