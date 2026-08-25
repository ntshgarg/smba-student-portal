"use client"

import { Check } from "lucide-react"

import type { PlayerOnboardingStage } from "@/lib/coach/onboarding"

import styles from "../player-onboarding-register.module.css"
import { folio, STAGES } from "./shared"

export function StepRail({ current }: { current: PlayerOnboardingStage }) {
  const currentIndex = STAGES.findIndex((stage) => stage.key === current)

  return (
    <ol className={styles.stepRail} aria-label="Academy onboarding progress">
      {STAGES.map((stage, index) => {
        const complete = index < currentIndex
        return (
          <li
            className={complete ? styles.completeStep : index === currentIndex ? styles.currentStep : ""}
            key={stage.key}
            aria-current={index === currentIndex ? "step" : undefined}
          >
            <span>{complete ? <Check aria-hidden="true" /> : folio(index)}</span>
            <strong>{stage.label}</strong>
          </li>
        )
      })}
    </ol>
  )
}
