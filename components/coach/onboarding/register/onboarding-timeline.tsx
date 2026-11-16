"use client"

import { shownTrainingStart, type PlayerOnboardingCase } from "@/lib/coach/onboarding"
import { formatDateKey } from "@/lib/format"

const timelineDateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
})

/** The Members record's Joining line (app/portal.css), so the steps read the same in both places. */
export function OnboardingTimeline({ item }: { item: PlayerOnboardingCase }) {
  // The date approval stamps is a stand-in until the Session step confirms one.
  const trainingStart = shownTrainingStart(item)
  const steps = [
    { label: "Requested", value: item.requestedAt ? timelineDateFormat.format(new Date(item.requestedAt)) : null },
    { label: "Approved", value: item.approvedAt ? timelineDateFormat.format(new Date(item.approvedAt)) : null },
    { label: "Account set up", value: item.activatedAt ? timelineDateFormat.format(new Date(item.activatedAt)) : null },
    { label: "Training from", value: trainingStart ? formatDateKey(trainingStart) : null },
    {
      label: "Onboarded",
      value: item.onboardingCompletedAt ? timelineDateFormat.format(new Date(item.onboardingCompletedAt)) : null,
    },
  ]

  return (
    <div className="coach-member-joining">
      <span>Joining</span>
      <ol>
        {steps.map((step) => (
          <li key={step.label} className={step.value ? undefined : "is-pending"}>
            <span className="coach-member-joining-mark" aria-hidden="true" />
            <strong>{step.label}</strong>
            <small>{step.value ?? (step.label === "Training from" ? "Not set yet" : "Not yet")}</small>
          </li>
        ))}
      </ol>
    </div>
  )
}
