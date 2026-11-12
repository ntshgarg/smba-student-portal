"use client"

import { useEffect } from "react"

import { InlineNotice } from "@/components/inline-notice"

import recordsStyles from "./financial-records.module.css"

/*
 * The note shown once when a records list starts again from page 1
 * (app/coach/financials/records/page.tsx readPage). The `restarted` flag is
 * then taken out of the address, so a refresh, the browser's Back button or a
 * bookmark lands on a plain page 1 instead of repeating news about a change
 * that already happened. The note stays on screen for this visit.
 */
export function RecordsRestartNotice({ message }: { message: string }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has("restarted")) return
    params.delete("restarted")
    const query = params.toString()
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    )
  }, [])

  return (
    <InlineNotice
      className={recordsStyles.recordsNotice}
      message={message}
      reserveSpace={false}
      tone="info"
    />
  )
}
