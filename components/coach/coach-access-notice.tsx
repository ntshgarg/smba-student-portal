"use client"

import { useEffect } from "react"
import { CircleAlert } from "lucide-react"

/**
 * The address with the one-shot `notice` taken off, or `null` when it has none.
 *
 * The refusal redirect puts `?notice=head-coach-only` in the address so the
 * dashboard can say why the coach landed there. Left in place, a reload or a
 * bookmark of the dashboard said "Head coach access only" again with nothing
 * refused.
 */
export function addressWithoutNotice(href: string) {
  const url = new URL(href)
  if (!url.searchParams.has("notice")) return null
  url.searchParams.delete("notice")
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Takes the notice off the address, in the router as well as the address bar.
 *
 * The state handed to `replaceState` must be `null`, as the Next.js guide does
 * it. Next's patched `replaceState` passes a state carrying its own `__NA` flag
 * straight to the browser and skips updating the router, so handing back
 * `history.state` cleaned only the address bar: `useSearchParams()` kept
 * `notice`, and the next month step on the attendance card pushed it back into
 * the address. With `null`, Next copies its internals across itself and moves
 * the router to the cleaned address.
 */
export function dropNoticeFromAddress(
  { history, location }: { history: Pick<History, "replaceState">; location: Pick<Location, "href"> },
) {
  const cleaned = addressWithoutNotice(location.href)
  if (cleaned !== null) history.replaceState(null, "", cleaned)
}

export function CoachAccessNotice() {
  useEffect(() => {
    // Shown once: the notice stays on screen for this visit, but the address
    // stops carrying it.
    dropNoticeFromAddress(window)
  }, [])

  return (
    <aside className="coach-access-notice" role="status">
      <CircleAlert aria-hidden="true" />
      <span>
        <strong>Head coach access only.</strong>{" "}
        The page you asked for is not part of the assistant coach workspace, so you
        are back on your dashboard.
      </span>
    </aside>
  )
}
