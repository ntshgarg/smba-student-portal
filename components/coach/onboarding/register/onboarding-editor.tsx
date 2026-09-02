"use client"

import type { PlayerOnboardingCase } from "@/lib/coach/onboarding"
import type { TrainingSessionSeries } from "@/lib/sessions/types"

import styles from "../player-onboarding-register.module.css"
import { AssessmentStep } from "./assessment-step"
import { FeePlanStep } from "./fee-plan-step"
import { OnboardingTimeline } from "./onboarding-timeline"
import { RequestStep } from "./request-step"
import { SessionStep } from "./session-step"
import { StepRail } from "./step-rail"

function editorCopy(item: PlayerOnboardingCase) {
  const firstName = item.fullName.split(/\s+/u)[0]
  switch (item.stage) {
    case "request":
      if (item.requestedRole === "coach") {
        return {
          title: `Review ${firstName}’s staff request`,
          body: "Approve the assistant coach to create their Academy ID and activate staff access.",
        }
      }
      return {
        title: `Review ${firstName}’s request`,
        body: "Approve the player to create their Academy ID and begin assessment.",
      }
    case "assessment":
      return {
        title: `Complete ${firstName}’s assessment`,
        body: "Confirm the court assessment before assigning a recurring session.",
      }
    case "session":
      return {
        title: `Assign ${firstName}’s court time`,
        body: "Choose a matching recurring schedule and the player’s attendance days.",
      }
    case "feePlan":
      return {
        title: `Confirm ${firstName}’s Fee Plan`,
        body: "Record the agreed monthly training fee to complete onboarding.",
      }
  }
}

export function OnboardingEditor({
  financeActive,
  item,
  onSuccess,
  referenceDate,
  sessionSeries,
}: {
  financeActive: boolean
  item: PlayerOnboardingCase
  onSuccess: (input: {
    message: string
    remove?: boolean
  }) => void
  referenceDate: string
  sessionSeries: TrainingSessionSeries[]
}) {
  const copy = editorCopy(item)

  return (
    <div
      className={styles.editor}
      id={`onboarding-editor-${item.id}`}
      role="region"
      aria-labelledby={`onboarding-editor-title-${item.id}`}
    >
      <StepRail current={item.stage} />
      <div className={styles.editorWork}>
        <div className={styles.editorHeading}>
          <span>Next action</span>
          <h3 id={`onboarding-editor-title-${item.id}`} tabIndex={-1}>{copy.title}</h3>
          <p>{copy.body}</p>
        </div>
        <OnboardingTimeline item={item} />
        {item.stage === "request" ? <RequestStep item={item} onSuccess={onSuccess} /> : null}
        {item.stage === "assessment" ? <AssessmentStep item={item} onSuccess={onSuccess} /> : null}
        {item.stage === "session" ? (
          <SessionStep
            item={item}
            onSuccess={onSuccess}
            referenceDate={referenceDate}
            sessionSeries={sessionSeries}
          />
        ) : null}
        {item.stage === "feePlan" ? (
          <FeePlanStep
            financeActive={financeActive}
            item={item}
            onSuccess={onSuccess}
            referenceDate={referenceDate}
          />
        ) : null}
      </div>
    </div>
  )
}
