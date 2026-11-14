"use client"

import { useEffect, useRef, useState } from "react"

import type { ShuttleRenderer } from "./shuttle-renderer"

/**
 * The owner's rule (14 Nov 2026): the shuttle shows only while the hero is side by side on a landscape
 * screen, never on a phone. The height floor keeps large phones turned sideways (900+ px wide but at most
 * about 430 px tall) out, and still lets in short laptop windows. app/public-home.css hides the slot with
 * the same test; keep the two in step.
 */
export const HERO_SHUTTLE_MEDIA = "(min-width: 901px) and (orientation: landscape) and (min-height: 480px)"
const REDUCED_MOTION_MEDIA = "(prefers-reduced-motion: reduce)"
// a valid 1x1 transparent GIF: "data:," is not an image and logs a load error
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

type LoadRenderer = () => Promise<typeof import("./shuttle-renderer")>
type LoadRings = () => Promise<typeof import("./tournament-rings")>

/** Run `task` once the page has loaded and the main thread is idle (or 300 ms have passed). Returns a cancel. */
function whenIdleAfterLoad(task: () => void) {
  let idle = 0
  let timer = 0
  const schedule = () => {
    // Safari has no requestIdleCallback
    if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(task, { timeout: 300 })
    else timer = window.setTimeout(task, 0)
  }
  if (document.readyState === "complete") schedule()
  else window.addEventListener("load", schedule, { once: true })
  return () => {
    window.removeEventListener("load", schedule)
    if (idle) window.cancelIdleCallback(idle)
    if (timer) window.clearTimeout(timer)
  }
}

/**
 * Keeps the live shuttle running exactly while the slot is shown and motion is allowed. The renderer is
 * imported only then, once the page has loaded and gone idle; turning a tablet upright or asking for
 * reduced motion tears it down on the spot, and the reverse starts it again. Returns the cleanup.
 */
export function controlHeroShuttle(
  slot: HTMLElement,
  still: HTMLElement | null,
  onLive: (live: boolean) => void,
  loadRenderer: LoadRenderer = () => import("./shuttle-renderer"),
) {
  if (typeof window.matchMedia !== "function") return () => {}
  const shown = window.matchMedia(HERO_SHUTTLE_MEDIA)
  const reducedMotion = window.matchMedia(REDUCED_MOTION_MEDIA)
  let renderer: ShuttleRenderer | null = null
  // the wait for an idle moment and the import that follows it
  let loading: { run: number; cancelWait: () => void } | null = null
  // bumped whenever the shuttle stops, so a load still in flight knows it is no longer wanted
  let run = 0

  const load = (current: number) =>
    loadRenderer()
      .then(({ startShuttle }) => {
        if (current !== run) return
        renderer = startShuttle(slot, { still, pointerArea: slot.closest("section") })
        if (renderer) requestAnimationFrame(() => current === run && onLive(true))
        // no WebGL2: the spiral drawing stays, at full strength
        else still?.style.setProperty("opacity", "1")
      })
      // a failed load leaves the still at full strength, the same as having no WebGL2
      .catch(() => {
        if (current === run) still?.style.setProperty("opacity", "1")
      })
      .finally(() => {
        if (loading?.run === current) loading = null
      })

  const stop = () => {
    run++
    loading?.cancelWait()
    loading = null
    if (renderer) {
      renderer.destroy()
      renderer = null
      onLive(false)
    }
    still?.style.removeProperty("opacity")
  }

  const sync = () => {
    if (!shown.matches || reducedMotion.matches) {
      stop()
      return
    }
    if (renderer || loading) return
    const current = run
    loading = { run: current, cancelWait: whenIdleAfterLoad(() => load(current)) }
  }

  sync()
  shown.addEventListener("change", sync)
  reducedMotion.addEventListener("change", sync)
  return () => {
    shown.removeEventListener("change", sync)
    reducedMotion.removeEventListener("change", sync)
    stop()
  }
}

/**
 * Draws the tournament watermark behind the shuttle once the slot is shown and the page is idle, and again
 * whenever the slot changes size. It is static, so it is drawn with or without reduced motion. The italic
 * font is the one the headline already loads; drawing waits for it so the fallback never shows.
 */
export function controlWatermark(slot: HTMLElement, canvas: HTMLCanvasElement, loadRings: LoadRings = () => import("./tournament-rings")) {
  if (typeof window.matchMedia !== "function") return () => {}
  const shown = window.matchMedia(HERO_SHUTTLE_MEDIA)
  let rings: Awaited<ReturnType<LoadRings>> | null = null
  let drawn = ""
  let frame = 0
  let cancelWait: (() => void) | null = null
  let stopped = false

  // a drawing in progress, stepped a slice per frame; a resize starts a fresh one
  let steps: Generator<void, void, void> | null = null
  const pump = () => {
    frame = 0
    if (!steps) return
    const until = performance.now() + 6
    while (performance.now() < until) {
      if (steps.next().done) {
        steps = null
        canvas.dataset.drawn = ""
        // the slot may have changed size while this drawing was in progress
        schedule()
        return
      }
    }
    frame = requestAnimationFrame(pump)
  }
  const draw = () => {
    frame = 0
    if (!rings || !shown.matches) return
    const width = slot.clientWidth
    const height = slot.clientHeight
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const size = `${width}x${height}@${pixelRatio}`
    if (!width || !height || size === drawn) return
    drawn = size
    const style = getComputedStyle(slot)
    steps = rings.drawTournamentRings(canvas, {
      width,
      height,
      pixelRatio,
      fontFamily: style.getPropertyValue("--font-newsreader").trim() || "Georgia, serif",
      ink: style.getPropertyValue("--ink").trim() || "#0c1117",
    })
    pump()
  }
  const schedule = () => {
    if (!frame && rings) frame = requestAnimationFrame(draw)
  }

  const start = () => {
    if (rings || cancelWait || !shown.matches) return schedule()
    cancelWait = whenIdleAfterLoad(() => {
      const family = getComputedStyle(slot).getPropertyValue("--font-newsreader").trim()
      Promise.all([loadRings(), family ? document.fonts.load(`italic 500 16px ${family}`) : null])
        .then(([module]) => {
          if (stopped) return
          rings = module
          schedule()
        })
        // without the watermark the hero is simply plainer; the next time the slot is shown tries again
        .catch(() => {
          cancelWait = null
        })
    })
  }

  const resizeObserver = new ResizeObserver(schedule)
  // the box in device pixels also changes when the window moves to a screen with another pixel ratio
  try {
    resizeObserver.observe(slot, { box: "device-pixel-content-box" })
  } catch {
    resizeObserver.observe(slot)
  }
  start()
  shown.addEventListener("change", start)
  return () => {
    stopped = true
    cancelWait?.()
    if (frame) cancelAnimationFrame(frame)
    resizeObserver.disconnect()
    shown.removeEventListener("change", start)
  }
}

/**
 * The hero's right-hand visual: a line-drawn shuttlecock that starts as a flat spiral and turns into
 * the shuttle (shuttle-model.ts). Decorative, so hidden from assistive technology and never focusable.
 *
 * The server sends only a still: the faint flat spiral, or the resting shuttle when the visitor asks for
 * reduced motion (the <picture> swaps it, live). The canvas fades in over the still once it is running.
 * The tournament watermark (tournament-rings.ts) is drawn behind both.
 */
export function HeroShuttle() {
  const slotRef = useRef<HTMLDivElement>(null)
  const stillRef = useRef<HTMLImageElement>(null)
  const watermarkRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<"still" | "live">("still")

  useEffect(() => {
    if (!slotRef.current) return
    const slot = slotRef.current
    const stopShuttle = controlHeroShuttle(slot, stillRef.current, (live) => setState(live ? "live" : "still"))
    const stopWatermark = watermarkRef.current ? controlWatermark(slot, watermarkRef.current) : () => {}
    return () => {
      stopShuttle()
      stopWatermark()
    }
  }, [])

  return (
    <div ref={slotRef} className="hero-visual" aria-hidden="true" data-shuttle-state={state}>
      <canvas ref={watermarkRef} className="hero-shuttle-watermark" />
      <picture>
        {/* where the slot is hidden (phones, upright tablets) nothing is fetched: a blank inline image */}
        <source media={`not all and ${HERO_SHUTTLE_MEDIA}`} srcSet={BLANK_IMAGE} />
        <source media={REDUCED_MOTION_MEDIA} srcSet="/images/hero-shuttle-rest.svg" />
        {/* eager, not lazy: the still is the largest thing in the first view, so loading it late would
            hold back the page's largest paint */}
        <img
          ref={stillRef}
          className="hero-shuttle-still"
          src="/images/hero-shuttle-spiral.svg"
          alt=""
          width={1000}
          height={1000}
          decoding="async"
        />
      </picture>
    </div>
  )
}
