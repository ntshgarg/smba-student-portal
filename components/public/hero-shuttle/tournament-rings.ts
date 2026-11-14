/**
 * The faint watermark behind the hero shuttle: the names of BWF's events (the 2026 World Tour at every
 * level, plus the World Championships and the team cups) set in tiny italic around concentric rings, so it
 * reads as an engraved texture from a distance and the names can be read up close. The innermost ring,
 * nearest the shuttle, carries the academy's own name in the same ink.
 *
 * It is drawn onto a canvas, a slice at a time, rather than laid out as SVG text: some 25,000 letters on
 * curved paths froze the browser for over a second on every repaint. It uses the italic Newsreader the headline
 * already loads, so it costs no extra font download.
 */

export const BWF_EVENTS = [
  "BWF World Championships",
  "Thomas Cup",
  "Uber Cup",
  "Sudirman Cup",
  "BWF World Tour Finals",
  "Malaysia Open",
  "All England Open",
  "Indonesia Open",
  "China Open",
  "India Open",
  "Singapore Open",
  "Japan Open",
  "China Masters",
  "Denmark Open",
  "French Open",
  "Indonesia Masters",
  "Thailand Open",
  "Malaysia Masters",
  "Australian Open",
  "Arctic Open",
  "Hylo Open",
  "Korea Open",
  "Japan Masters",
  "Hong Kong Open",
  "Thailand Masters",
  "German Open",
  "Swiss Open",
  "Orléans Masters",
  "Macau Open",
  "U.S. Open",
  "Canada Open",
  "Taipei Open",
  "Korea Masters",
  "Syed Modi International",
  "Ruichang China Masters",
  "Baoji China Masters",
  "Vietnam Open",
  "Malaysia Super 100",
  "Kaohsiung Masters",
  "Guwahati Masters",
  "Odisha Masters",
  "World Junior Championships",
  "Suhandinata Cup",
  "World Senior Championships",
  "Para Badminton World Championships",
] as const

export const ACADEMY = "Sathiya Moorthy Badminton Academy · Mahadevapura · Bengaluru"
const SEPARATOR = " · "

// In layout units: 1000 across the slot's longer side, the rings centred in it.
const FONT_SIZE = 10.4
const LETTER_SPACING = 0.3
// a rough average advance for Newsreader italic, used only to choose how many whole names fit a ring
const CHAR_WIDTH = FONT_SIZE * 0.4 + LETTER_SPACING
const FIRST_RADIUS = 95
const RING_STEP = 10.9
const LAST_RADIUS = 780
const INK_ALPHA = 0.16
// the ink fades with the distance from the centre: full strength to this share of the way to a corner,
// gone by the next
const FADE_FROM = 0.42
const FADE_TO = 0.82
// letters drawn between yields: a slice stays well inside one frame even on a slow laptop
const LETTERS_PER_SLICE = 60

export interface Ring {
  r: number
  /** where the text starts, in radians clockwise from the right */
  start: number
  text: string
}

/** Whole phrases, each followed by a separator, that fill about `length`: nothing is cut at the seam. */
function fill(length: number, phrases: readonly string[], first: number) {
  let text = ""
  for (let i = first; ; i++) {
    const next = phrases[i % phrases.length] + SEPARATOR
    if (text && (text.length + next.length / 2) * CHAR_WIDTH > length) return text
    text += next
  }
}

export function tournamentRings(): Ring[] {
  const rings: Ring[] = []
  for (let i = 0, r = FIRST_RADIUS; r <= LAST_RADIUS + 1e-6; i++, r += RING_STEP) {
    const length = 2 * Math.PI * r
    const text = i === 0 ? fill(length, [ACADEMY], 0) : fill(length, BWF_EVENTS, i * 7)
    rings.push({ r, start: i * 0.65, text })
  }
  return rings
}

/**
 * Draw the rings for a `width` x `height` slot at `pixelRatio`, a slice at a time: the generator yields
 * every few dozen letters so the caller can spread the work over frames and never block the page. The
 * drawing is built on its own canvas and copied to `target` only when complete, so a redraw after a
 * resize never shows a half-drawn or blank watermark. Each ring's letters are spaced to close its circle
 * exactly. The ink fades out from the centre (FADE_FROM to FADE_TO of the way to a corner) and over
 * the slot's left 18%, so it melts into the page before the text column; the faded-out rings aren't drawn.
 */
export function* drawTournamentRings(
  target: HTMLCanvasElement,
  { width, height, pixelRatio, fontFamily, ink }: {
    width: number
    height: number
    pixelRatio: number
    fontFamily: string
    ink: string
  },
): Generator<void, void, void> {
  const canvas = document.createElement("canvas")
  // a CPU canvas, so reading a pixel back (below) is cheap
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return
  canvas.width = Math.max(1, Math.round(width * pixelRatio))
  canvas.height = Math.max(1, Math.round(height * pixelRatio))
  const unit = (Math.max(width, height) / 1000) * pixelRatio
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const corner = Math.hypot(cx, cy)
  const edge = 0.18 * canvas.width
  const font = `italic 500 ${FONT_SIZE * unit}px ${fontFamily}`

  const advance = new Map<string, number>()
  const widthOf = (ch: string) => {
    let w = advance.get(ch)
    if (w === undefined) {
      w = ctx.measureText(ch).width
      advance.set(ch, w)
    }
    return w
  }
  // the context's text state survives between slices, but set it again in case anything reset it
  const prepare = () => {
    ctx.font = font
    ctx.fillStyle = ink
    ctx.textBaseline = "middle"
    ctx.textAlign = "center"
  }
  prepare()

  let sinceYield = 0
  for (const ring of tournamentRings()) {
    const r = ring.r * unit
    const fade = 1 - Math.min(1, Math.max(0, (r / corner - FADE_FROM) / (FADE_TO - FADE_FROM)))
    // the rings only grow from here
    if (fade <= 0) break
    const chars = [...ring.text]
    const natural = chars.reduce((sum, ch) => sum + widthOf(ch), 0)
    // spread the gaps so the text closes the circle, as SVG's textLength would
    const gap = (2 * Math.PI * r - natural) / chars.length
    let along = 0
    for (const ch of chars) {
      const w = widthOf(ch)
      const angle = ring.start + (along + w / 2) / r
      along += w + gap
      if (ch === " ") continue
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const x = cx + r * cos
      const alpha = INK_ALPHA * fade * Math.min(1, x / edge)
      if (alpha <= 0) continue
      ctx.globalAlpha = alpha
      // letters stand upright on the ring, facing outward, running clockwise
      ctx.setTransform(-sin, cos, -cos, -sin, x, cy + r * sin)
      ctx.fillText(ch, 0, 0)
      if (++sinceYield >= LETTERS_PER_SLICE) {
        sinceYield = 0
        // the browser only records the letters and draws them all at the end of the frame, which put
        // the whole drawing into a few long frames: reading a pixel back makes it draw them now
        ctx.getImageData(0, 0, 1, 1)
        yield
        prepare()
      }
    }
  }

  target.width = canvas.width
  target.height = canvas.height
  target.getContext("2d")?.drawImage(canvas, 0, 0)
}
