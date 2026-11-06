"use client"

import { useEffect, useState } from "react"

import { MOTION_EXIT_MS, prefersReducedMotion } from "./motion-tokens"

/**
 * Keeps a conditionally rendered surface (a menu, a sheet) mounted for the
 * length of its exit, so it can shrink back into its trigger instead of
 * vanishing. `open` stays the single source of truth for what the surface
 * means: aria-expanded and aria-controls follow it immediately, and the
 * closing copy is marked `data-state="closing"` so CSS plays the exit and the
 * caller can make it inert.
 *
 * Reopening mid-exit returns the same element to `open`, so a CSS transition
 * reverses from wherever it got to rather than restarting. With reduced motion
 * the surface unmounts on the next tick.
 */
export function usePresence(open: boolean, exitMs: number = MOTION_EXIT_MS) {
  const [mounted, setMounted] = useState(open)

  // Mount synchronously on open (adjusting state during render is React's
  // documented pattern for deriving from a prop), so the entrance starts on
  // the same frame as the click.
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open || !mounted) return
    const timer = window.setTimeout(
      () => setMounted(false),
      prefersReducedMotion() ? 0 : exitMs,
    )
    return () => window.clearTimeout(timer)
  }, [exitMs, mounted, open])

  return {
    mounted: open || mounted,
    state: open ? "open" : "closing",
  } as const
}
