import Link from "next/link"
import { ArrowLeft, ReceiptText } from "lucide-react"
import { redirect } from "next/navigation"

import { PlayerFeeRecordView } from "@/components/financials/player-fee-record"
import styles from "@/components/financials/player-financials.module.css"
import { getPlayerFeeRecord } from "@/lib/finance/service"
import { getCurrentStudent } from "@/lib/student/current-student"

export const metadata = {
  title: "Fee record",
}

type PlayerFinancialsPageProps = {
  searchParams?: Promise<PlayerFinancialsSearchParams>
}

type PlayerFinancialsSearchParams = {
  month?: string | string[]
  year?: string | string[]
}

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function PlayerFinancialsPage({
  searchParams,
}: PlayerFinancialsPageProps = {}) {
  const student = await getCurrentStudent()
  if (!student) redirect("/login")

  const [record, requestedSelection] = await Promise.all([
    getPlayerFeeRecord(student.identity.playerId),
    searchParams ?? Promise.resolve<PlayerFinancialsSearchParams>({}),
  ])

  return (
    <div className={`${styles.page} interior-page page-shell`}>
      <div className={styles.toolbar}>
        <Link className="back-link" href="/player">
          <ArrowLeft aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>

      <header className={styles.pageHeader}>
        <h1>Your fee record.</h1>
      </header>

      {record ? (
        <PlayerFeeRecordView
          record={record}
          requestedMonth={firstSearchValue(requestedSelection.month)}
          requestedYear={firstSearchValue(requestedSelection.year)}
        />
      ) : (
        <section className={`${styles.pageState} empty-state`} aria-labelledby="fee-record-empty-title">
          <ReceiptText aria-hidden="true" />
          <h2 id="fee-record-empty-title">Your fee record will appear after onboarding.</h2>
          <p>Charges and payments will appear here once the academy completes the setup.</p>
        </section>
      )}
    </div>
  )
}
