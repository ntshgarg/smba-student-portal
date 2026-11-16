"use client"

import { useState } from "react"

import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import type { PlayerOnboardingCase, PlayerOnboardingStage } from "@/lib/coach/onboarding"
import type { TrainingSessionSeries } from "@/lib/sessions/types"

import styles from "../player-onboarding-register.module.css"
import { AssessmentStep } from "./assessment-step"
import { FeePlanStep } from "./fee-plan-step"
import { RequestStep } from "./request-step"
import { SessionStep } from "./session-step"
import { StepRail } from "./step-rail"

/**
 * The record's name for screen readers. The band already shows who it is and
 * the open tab shows the step, so nothing here is painted; focus goes to that
 * tab instead, where a keyboard user can see it.
 */
function editorTitle(item: PlayerOnboardingCase, stage: PlayerOnboardingStage) {
  const firstName = item.fullName.split(/\s+/u)[0]
  switch (stage) {
    case "request":
      return item.requestedRole === "coach"
        ? `Review ${firstName}’s staff request`
        : `Review ${firstName}’s request`
    case "assessment":
      return `Complete ${firstName}’s assessment`
    case "session":
      // Revisited, this step reports an assignment rather than offering to make one.
      if (item.assignedSession?.standing === "running") return `${firstName}’s court time is set`
      if (item.assignedSession?.standing === "finished" || item.assignedSession?.standing === "ended") {
        return `${firstName}’s first term is over`
      }
      if (item.assignedSession) return `Start ${firstName}’s court time again`
      return `Assign ${firstName}’s court time`
    case "feePlan":
      return `Confirm ${firstName}’s Fee Plan`
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
    window.requestAnimationFrame(() => document.getElementById(`onboarding-current-step-${item.id}`)?.focus())
  }

  return (
    <div
      className={styles.editor}
      id={`onboarding-editor-${item.id}`}
      role="region"
      aria-labelledby={`onboarding-editor-title-${item.id}`}
    >
      <h3 className="sr-only" id={`onboarding-editor-title-${item.id}`}>
        {editorTitle(item, viewStage)}
      </h3>
      <StepRail
        current={viewStage}
        currentId={`onboarding-current-step-${item.id}`}
        onSelect={selectStage}
        reachedStage={item.stage}
        staff={item.requestedRole === "coach"}
      />
      <div className={styles.editorBody}>
        {/* Only where the step is still a form: a locked or assigned step says so itself. */}
        {revisiting && viewStage === "assessment" && !item.assignedSession ? (
          <p className={styles.note} role="note">
            Already done. Changes are fine until onboarding is complete.
          </p>
        ) : null}
        {viewStage === "request" ? <RequestStep item={item} onSuccess={onSuccess} /> : null}
        {viewStage === "assessment" ? <AssessmentStep item={item} onSuccess={onSuccess} /> : null}
        {viewStage === "session" ? (
          <SessionStep
            item={item}
            onGoToFeePlan={item.stage === "feePlan" ? () => selectStage("feePlan") : undefined}
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
