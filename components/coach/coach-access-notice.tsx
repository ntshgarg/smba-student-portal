"use client"

import { useEffect } from "react"
import { CircleAlert } from "lucide-react"

export function CoachAccessNotice() {
  useEffect(() => {
    // Shown once: drop `notice` from the address. A `null` state keeps Next's router in step.
    const url = new URL(window.location.href)
    if (!url.searchParams.has("notice")) return
    url.searchParams.delete("notice")
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
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
