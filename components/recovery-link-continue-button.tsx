"use client"

import { ArrowRight } from "lucide-react"
import { useFormStatus } from "react-dom"

// Disabled while pending: the link is single-use, so a second tap would fail.
export function RecoveryLinkContinueButton() {
  const { pending } = useFormStatus()
  return (
    <button className="login-submit" type="submit" disabled={pending}>
      <span>{pending ? "Opening…" : "Continue"}</span>
      <ArrowRight aria-hidden="true" />
    </button>
  )
}
