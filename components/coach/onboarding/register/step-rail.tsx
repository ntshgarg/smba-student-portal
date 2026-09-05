"use client"

import { Check } from "lucide-react"

import type { PlayerOnboardingStage } from "@/lib/coach/onboarding"

import styles from "../player-onboarding-register.module.css"
import { folio, STAGES } from "./shared"

/**
 * The rail was a picture of progress: an `<ol>` of `<span>`/`<strong>` with
 * nothing to press. Combined with the editor rendering only the step matching
 * the server-derived stage, that made onboarding a one-way street -- once a step
 * saved, its form stopped existing, and the Session step's own error text
 * ("Change the training start date in Assessment to start earlier") named a
 * screen the coach could no longer reach. The only way back was the destructive
 * reset in Fee Plan, which is refused outright once any attendance, fee or
 * charge row exists.
 *
 * So the rail is the navigation now. A step the case has already reached is a
 * button; a step ahead of it stays inert, because nothing there can be filled in
 * before the steps before it are. `request` is never a button: approval
 * allocates an Academy ID and there is no path that gives one back.
 */
export function StepRail({
  current,
  onSelect,
  reachedStage,
}: {
  current: PlayerOnboardingStage
  onSelect?: (stage: PlayerOnboardingStage) => void
  reachedStage: PlayerOnboardingStage
}) {
  const currentIndex = STAGES.findIndex((stage) => stage.key === current)
  const reachedIndex = STAGES.findIndex((stage) => stage.key === reachedStage)

  return (
    <ol className={styles.stepRail} aria-label="Academy onboarding progress">
      {STAGES.map((stage, index) => {
        const complete = index < reachedIndex
        const marker = <span>{complete ? <Check aria-hidden="true" /> : folio(index)}</span>
        // The short form; see the note on `railLabel`. The full name still reaches
        // a screen reader through the button's aria-label below, and each short
        // form is a prefix of it, so speech input matches what is on screen.
        const label = <strong>{stage.railLabel}</strong>
        // Index 0 is `request`; see the note above on why it is never navigable.
        const navigable = Boolean(onSelect)
          && index > 0
          && index <= reachedIndex
          && index !== currentIndex
        // Once the coach has stepped back, the steps between them and the live
        // edge are ahead of where they stand. Calling those "go back" is simply
        // wrong, and the aria-label is the only name a screen reader gets.
        const goingBack = index < currentIndex

        return (
          <li
            /*
              * "You are here" outranks "this is done". A coach who has gone back
              * to a finished step is standing on it, and marking it only as
              * complete left the rail with nothing showing where they were. The
              * marker inside still carries the tick, so a revisited step reads as
              * both: done, and current.
              */
            className={index === currentIndex ? styles.currentStep : complete ? styles.completeStep : ""}
            key={stage.key}
            aria-current={index === currentIndex ? "step" : undefined}
          >
            {navigable ? (
              <button
                aria-label={`${goingBack ? "Go back to" : "Go forward to"} ${stage.label}`}
                onClick={() => onSelect?.(stage.key)}
                type="button"
              >
                {marker}
                {label}
              </button>
            ) : (
              <>
                {marker}
                {label}
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}
