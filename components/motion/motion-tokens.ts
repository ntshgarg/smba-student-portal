/**
 * Script-side mirror of the motion tokens in app/globals.css. CSS owns the
 * timing of every animation; these numbers exist only for the few places a
 * script has to wait for one to finish, such as keeping a closing menu mounted
 * until its exit has played. Keep them equal to --duration-enter and
 * --duration-exit (tests/motion-tokens.test.ts holds the two files together).
 */
export const MOTION_ENTER_MS = 220
/** Exits run 20% shorter than entrances. */
export const MOTION_EXIT_MS = Math.round(MOTION_ENTER_MS * 0.8)

export function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
