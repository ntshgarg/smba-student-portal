"use client"

import { CircleAlert } from "lucide-react"
import Link from "next/link"

import styles from "../financials.module.css"
import type { PlayerFinancialLedgerView } from "../types"

export function OnboardingFinanceSetup({ ledger }: { ledger: PlayerFinancialLedgerView }) {
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
