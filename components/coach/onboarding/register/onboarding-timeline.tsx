"use client"

import type { PlayerOnboardingCase } from "@/lib/coach/onboarding"
import { formatDateKey } from "@/lib/format"

import styles from "../player-onboarding-register.module.css"

const timelineDateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
})

function timelineDate(value: string | null | undefined, fallback = "Pending") {
  if (!value) return fallback
  return timelineDateFormat.format(new Date(value))
}

export function OnboardingTimeline({ item }: { item: PlayerOnboardingCase }) {
  return (
    <dl className={styles.dateTimeline} aria-label="Onboarding dates">
      <div><dt>Requested</dt><dd>{timelineDate(item.requestedAt)}</dd></div>
      <div><dt>Approved</dt><dd>{timelineDate(item.approvedAt)}</dd></div>
      <div><dt>Training start</dt><dd>{item.trainingStartOn ? formatDateKey(item.trainingStartOn) : "Pending"}</dd></div>
      <div><dt>Activated</dt><dd>{timelineDate(item.activatedAt)}</dd></div>
      <div><dt>Completed</dt><dd>{timelineDate(item.onboardingCompletedAt)}</dd></div>
    </dl>
  )
}
