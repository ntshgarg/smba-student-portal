import Link from "next/link"
import { ArrowLeft, ReceiptText } from "lucide-react"
import { redirect } from "next/navigation"

import { PlayerFeeRecordView } from "@/components/financials/player-fee-record"
import styles from "@/components/financials/player-financials.module.css"
import { PageIntro } from "@/components/page-intro"
import { getPlayerFeeRecord } from "@/lib/finance/service"
import { getCurrentStudent } from "@/lib/student/current-student"

export const metadata = {
  title: "Fee record",
}

export default async function PlayerFinancialsPage() {
  const student = await getCurrentStudent()
  if (!student) redirect("/login")

  const record = await getPlayerFeeRecord(student.identity.playerId)

  return (
    <div className={`${styles.page} interior-page page-shell`}>
      <div className={styles.toolbar}>
        <Link className="back-link" href="/player">
          <ArrowLeft aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>

      <PageIntro
        eyebrow="Fee record"
        title="Academy fees, clearly recorded."
        body="Review charges, due dates, receipts and recorded refunds in one read-only record."
      />

      {record ? (
        <PlayerFeeRecordView record={record} />
      ) : (
        <section className={`${styles.pageState} empty-state`} aria-labelledby="fee-record-empty-title">
          <ReceiptText aria-hidden="true" />
          <h2 id="fee-record-empty-title">Your fee record is being prepared.</h2>
          <p>Charges and payments will appear here once the academy completes the setup.</p>
        </section>
      )}
    </div>
  )
}
