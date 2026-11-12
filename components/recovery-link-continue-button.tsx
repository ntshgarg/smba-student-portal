"use client"

import { ArrowRight } from "lucide-react"
import { useFormStatus } from "react-dom"

/*
 * Continue on an emailed reset link. Opening the link is single-use, so a
 * second tap on a slow phone used to arrive after the first had already tied
 * the reset to this browser, and was sent to "invalid link" although the
 * first had worked. Disabled while the first is on its way.
 */
export function RecoveryLinkContinueButton() {
  const { pending } = useFormStatus()
  return (
    <button className="login-submit" type="submit" disabled={pending}>
      <span>{pending ? "Opening…" : "Continue"}</span>
      <ArrowRight aria-hidden="true" />
    </button>
  )
}
