"use client"

import { useEffect, useRef, useState } from "react"

import type { ShuttleRenderer } from "./shuttle-renderer"

/**
 * The owner's rule (14 Nov 2026): the shuttle shows only while the hero is side by side on a landscape
 * screen, never on a phone. The height floor keeps large phones turned sideways (900+ px wide but about
 * 430 px tall) out. app/public-home.css hides the slot with the same test; keep the two in step.
 */
export const HERO_SHUTTLE_MEDIA = "(min-width: 901px) and (orientation: landscape) and (min-height: 600px)"
const REDUCED_MOTION_MEDIA = "(prefers-reduced-motion: reduce)"
// a valid 1x1 transparent GIF: "data:," is not an image and logs a load error
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

type LoadRenderer = () => Promise<typeof import("./shuttle-renderer")>

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
 * The hero's right-hand visual: a line-drawn shuttlecock that starts as a flat spiral and turns into
 * the shuttle (shuttle-model.ts). Decorative, so hidden from assistive technology and never focusable.
 *
 * The server sends only a still: the faint flat spiral, or the resting shuttle when the visitor asks for
 * reduced motion (the <picture> swaps it, live). The canvas fades in over the still once it is running.
 */
export function HeroShuttle() {
  const slotRef = useRef<HTMLDivElement>(null)
  const stillRef = useRef<HTMLImageElement>(null)
  const [state, setState] = useState<"still" | "live">("still")

  useEffect(() => {
    if (!slotRef.current) return
    return controlHeroShuttle(slotRef.current, stillRef.current, (live) => setState(live ? "live" : "still"))
  }, [])

  return (
    <div ref={slotRef} className="hero-visual" aria-hidden="true" data-shuttle-state={state}>
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
