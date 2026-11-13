"use client"

import { CircleAlert } from "lucide-react"
import Link from "next/link"

import styles from "../financials.module.css"
import type { PlayerFinancialLedgerView } from "../types"

export function OnboardingFinanceSetup({ ledger }: { ledger: PlayerFinancialLedgerView }) {
  if (ledger.onboardingComplete) {
    // Onboarding is done, so it cannot set the fee any more. A schedule change
    // in Members asks for the monthly fee and starts a fee plan with it.
    return (
      <section className={styles.setupState}>
        <CircleAlert aria-hidden="true" />
        <div>
          <strong>This player has no fee plan</strong>
          <p>No monthly fee is issued for them. Set their fee with a schedule change from their record in Members.</p>
          <Link href={`/coach/members?player=${encodeURIComponent(ledger.playerId)}`}>
            Open the player&apos;s record in Members
          </Link>
        </div>
      </section>
    )
  }
  return (
    <section className={styles.setupState}>
      <CircleAlert aria-hidden="true" />
      <div>
        <strong>Complete this player’s onboarding first</strong>
        <p>Assessment, session assignment and the first Fee Plan are managed together in Player Onboarding.</p>
        <Link href={`/coach/onboarding?player=${encodeURIComponent(ledger.playerId)}`}>
          Continue Player Onboarding
        </Link>
      </div>
    </section>
  )
}
