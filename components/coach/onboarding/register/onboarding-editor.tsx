"use client"

import { useState } from "react"

import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import type { PlayerOnboardingCase, PlayerOnboardingStage } from "@/lib/coach/onboarding"
import type { TrainingSessionSeries } from "@/lib/sessions/types"

import styles from "../player-onboarding-register.module.css"
import { AssessmentStep } from "./assessment-step"
import { FeePlanStep } from "./fee-plan-step"
import { OnboardingTimeline } from "./onboarding-timeline"
import { RequestStep } from "./request-step"
import { SessionStep } from "./session-step"
import { StepRail } from "./step-rail"

function editorCopy(item: PlayerOnboardingCase, stage: PlayerOnboardingStage) {
  const firstName = item.fullName.split(/\s+/u)[0]
  switch (stage) {
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
      // Revisited, this step reports an assignment rather than offering to make
      // one; a heading still saying "assign" describes work that is done.
      if (item.assignedSession) {
        return {
          title: `${firstName}’s court time is set`,
          body: "The assigned schedule, and what it takes to change it.",
        }
      }
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
  /*
   * Which step is on screen is the coach's choice, not the database's. It starts
   * at the stage the case has reached and can be moved back to any step already
   * reached -- every one of them stays editable until onboarding completes, and
   * the server has always allowed that: `saveOnboardingAssessment` refuses only
   * once `onboardingCompletedAt` is set (lib/coach/onboarding-service.ts:96),
   * plus two narrow guards for moving a start date *later* or changing the
   * classification underneath an open assignment. Nothing needed loosening; the
   * way back simply did not exist.
   *
   * This resets to `item.stage` whenever the editor remounts, which the parent
   * forces on every save by keying on the record revision. Saving from a step
   * the coach went back to therefore returns them to the live edge of the case,
   * which is where the remaining work is.
   */
  const [viewStage, setViewStage] = useState<PlayerOnboardingStage>(item.stage)
  const revisiting = viewStage !== item.stage

  /*
   * Registers nothing dirty of its own -- it is here for `confirmNavigation`,
   * which asks about every dirty surface on the page. Switching steps unmounts
   * a form holding local state, so it is a discard like any other and has to go
   * through the same prompt as a link would.
   */
  const { confirmNavigation } = useUnsavedWorkGuard({
    isDirty: false,
    scope: `onboarding-step-nav:${item.id}`,
  })

  function selectStage(stage: PlayerOnboardingStage) {
    if (stage === viewStage || !confirmNavigation()) return
    setViewStage(stage)
    document.getElementById(`onboarding-editor-title-${item.id}`)?.focus({ preventScroll: false })
  }

  const copy = editorCopy(item, viewStage)

  return (
    <div
      className={styles.editor}
      id={`onboarding-editor-${item.id}`}
      role="region"
      aria-labelledby={`onboarding-editor-title-${item.id}`}
    >
      <StepRail current={viewStage} onSelect={selectStage} reachedStage={item.stage} />
      <div className={styles.editorWork}>
        <div className={styles.editorHeading}>
          <span>{revisiting ? "Revisiting" : "Next action"}</span>
          <h3 id={`onboarding-editor-title-${item.id}`} tabIndex={-1}>{copy.title}</h3>
          <p>{copy.body}</p>
        </div>
        <OnboardingTimeline item={item} />
        {revisiting ? (
          <p className={styles.revisitNote} role="note">
            You are back on a completed step. Changes save as normal — nothing is final until
            onboarding is completed.
          </p>
        ) : null}
        {viewStage === "request" ? <RequestStep item={item} onSuccess={onSuccess} /> : null}
        {viewStage === "assessment" ? <AssessmentStep item={item} onSuccess={onSuccess} /> : null}
        {viewStage === "session" ? (
          <SessionStep
            item={item}
            onGoToStage={selectStage}
            onSuccess={onSuccess}
            referenceDate={referenceDate}
            sessionSeries={sessionSeries}
          />
        ) : null}
        {viewStage === "feePlan" ? (
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
