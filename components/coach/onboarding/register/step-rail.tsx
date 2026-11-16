"use client"

import { Check } from "lucide-react"

import type { PlayerOnboardingStage } from "@/lib/coach/onboarding"

import styles from "../player-onboarding-register.module.css"
import { STAGES } from "./shared"

/**
 * The steps, as tabs along the bottom of the open record's band. They used to
 * be a picture of progress with nothing to press, which made onboarding a
 * one-way street: once a step saved its form stopped existing, and the only way
 * back was the destructive reset in Fee Plan, refused outright once any
 * attendance, fee or charge row exists.
 *
 * So a step the case has already reached is a button; a step ahead of it stays
 * inert, because nothing there can be filled in before the steps before it are.
 * `request` is never a button: approval allocates an Academy ID and there is no
 * path that gives one back. A staff request has no player steps after it, so
 * its record shows the one tab.
 */
export function StepRail({
  current,
  onSelect,
  reachedStage,
  staff = false,
}: {
  current: PlayerOnboardingStage
  onSelect?: (stage: PlayerOnboardingStage) => void
  reachedStage: PlayerOnboardingStage
  staff?: boolean
}) {
  const currentIndex = STAGES.findIndex((stage) => stage.key === current)
  const reachedIndex = STAGES.findIndex((stage) => stage.key === reachedStage)

  return (
    // Focusable because on a narrow phone the strip scrolls sideways, and a
    // keyboard has to be able to reach the tabs it hides.
    <ol className={styles.stepRail} aria-label="Academy onboarding progress" tabIndex={0}>
      {(staff ? STAGES.slice(0, 1) : STAGES).map((stage, index) => {
        const complete = index < reachedIndex
        const label = <>{complete ? <Check aria-hidden="true" /> : null}{stage.tabLabel}</>
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
              * to a finished step is standing on it; the tick inside still says
              * it is done, so a revisited step reads as both.
              */
            className={index === currentIndex ? styles.currentStep : complete ? styles.completeStep : undefined}
            key={stage.key}
            aria-current={index === currentIndex ? "step" : undefined}
          >
            {navigable ? (
              <button
                aria-label={`${goingBack ? "Go back to" : "Go forward to"} ${stage.label}`}
                onClick={() => onSelect?.(stage.key)}
                type="button"
              >
                {label}
              </button>
            ) : label}
          </li>
        )
      })}
    </ol>
  )
}
