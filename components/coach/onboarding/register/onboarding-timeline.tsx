"use client"

import { shownTrainingStart, type PlayerOnboardingCase } from "@/lib/coach/onboarding"
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
  // The date approval stamps is a stand-in until the Session step confirms one.
  const trainingStart = shownTrainingStart(item)
  return (
    <dl className={styles.dateTimeline} aria-label="Onboarding dates">
      <div><dt>Requested</dt><dd>{timelineDate(item.requestedAt)}</dd></div>
      <div><dt>Approved</dt><dd>{timelineDate(item.approvedAt)}</dd></div>
      <div><dt>Training start</dt><dd>{trainingStart ? formatDateKey(trainingStart) : "Pending"}</dd></div>
      <div><dt>Activated</dt><dd>{timelineDate(item.activatedAt)}</dd></div>
      <div><dt>Completed</dt><dd>{timelineDate(item.onboardingCompletedAt)}</dd></div>
    </dl>
  )
}
