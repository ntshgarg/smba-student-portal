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

export function CoachAccessNotice() {
  useEffect(() => {
    // Shown once: the notice stays on screen for this visit, but the address
    // stops carrying it. Next.js keeps its router in step with replaceState.
    const cleaned = addressWithoutNotice(window.location.href)
    if (cleaned !== null) window.history.replaceState(window.history.state, "", cleaned)
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
