import type { CSSProperties } from "react"
import Link from "next/link"

import type {
  ChargeView,
  PlayerFeeRecord,
  PlayerReceiptAllocationView,
  PlayerReceiptView,
  PlayerRefundView,
} from "@/lib/finance/types"
import {
  financeStatusLabel,
  formatBillingPeriod,
  formatFinanceAmount,
  formatFinanceDate,
  paymentMethodLabel,
} from "@/components/financials/player-finance-presentation"
import { getAcademyMonthKey } from "@/lib/format"
import styles from "@/components/financials/player-financials.module.css"

const MONTHS = [
  "01", "02", "03", "04", "05", "06",
  "07", "08", "09", "10", "11", "12",
] as const

const VALID_PERIOD = /^\d{4}-(?:0[1-9]|1[0-2])$/u
const VALID_YEAR = /^\d{4}$/u

type ReceiptRow = {
  receipt: PlayerReceiptView
}

type WithdrawalEvent = {
  receipt: PlayerReceiptView
  refund: PlayerRefundView
}

function issuedChargeByPeriod(charges: ChargeView[]) {
  const result = new Map<string, ChargeView>()

  charges.forEach((charge) => {
    if (!VALID_PERIOD.test(charge.billingPeriod ?? "")) return
    const period = charge.billingPeriod!
    const previous = result.get(period)

    if (!previous || (previous.lifecycle === "void" && charge.lifecycle === "issued")) {
      result.set(period, charge)
    }
  })

  return result
}

function recordYears(record: PlayerFeeRecord, currentPeriod: string) {
  const currentYear = currentPeriod.slice(0, 4)
  const years = new Set<string>([
    currentYear,
    String(Number(currentYear) - 1),
    String(Number(currentYear) - 2),
  ])

  record.monthlyCharges.forEach((charge) => {
    if (VALID_PERIOD.test(charge.billingPeriod ?? "")) years.add(charge.billingPeriod!.slice(0, 4))
  })

  record.receipts.forEach((receipt) => {
    const period = receipt.receivedOn.slice(0, 7)
    if (VALID_PERIOD.test(period)) years.add(period.slice(0, 4))
  })

  if (record.feeAgreement) {
    years.add(record.feeAgreement.effectiveFrom.slice(0, 4))
    if (record.feeAgreement.effectiveTo) years.add(record.feeAgreement.effectiveTo.slice(0, 4))
  }

  if (record.registrationCharge) years.add(record.registrationCharge.dueDate.slice(0, 4))

  return [...years].filter((year) => VALID_YEAR.test(year)).sort()
}

function receiptsByPeriod(record: PlayerFeeRecord) {
  const result = new Map<string, ReceiptRow[]>()
  const seenReceiptIds = new Set<string>()

  record.receipts.forEach((receipt) => {
    const period = receipt.receivedOn.slice(0, 7)
    if (!VALID_PERIOD.test(period) || seenReceiptIds.has(receipt.id)) return

    seenReceiptIds.add(receipt.id)
    result.set(period, [...(result.get(period) ?? []), { receipt }])
  })

  result.forEach((rows) => rows.sort((first, second) => (
    second.receipt.receivedOn.localeCompare(first.receipt.receivedOn)
      || second.receipt.id.localeCompare(first.receipt.id)
  )))

  return result
}

function receiptKindLabel(receipt: PlayerReceiptView) {
  const types = new Set(receipt.allocations.map((allocation) => allocation.chargeType))

  if (types.has("registration") && types.has("monthly_training")) {
    return "Registration + monthly receipt"
  }
  if (types.has("registration")) return "Registration receipt"
  if (types.has("monthly_training")) return "Monthly fee receipt"
  return "Fee receipt"
}

function receiptAllocationLabel(allocation: PlayerReceiptAllocationView) {
  if (allocation.chargeType === "registration") return "Registration fee"
  if (VALID_PERIOD.test(allocation.billingPeriod ?? "")) {
    return `${formatBillingPeriod(allocation.billingPeriod)} monthly fee`
  }
  return "Monthly fee"
}

function receiptMeta(receipt: PlayerReceiptView) {
  return [
    `Receipt ${receipt.receiptReference}`,
    paymentMethodLabel(receipt.method),
    receipt.externalReference ? `Payment reference ${receipt.externalReference}` : null,
    receipt.lifecycle === "reversed" ? "Reversed" : "Recorded",
  ].filter((item): item is string => Boolean(item))
}

function withdrawalForCharge(
  record: PlayerFeeRecord,
  charge: ChargeView,
): WithdrawalEvent | null {
  const events = record.receipts.flatMap((receipt) => {
    const allocatesCharge = receipt.allocations.some((allocation) => allocation.chargeId === charge.id)
    if (!allocatesCharge) return []

    return receipt.refunds
      .filter((refund) => (
        refund.purpose === "mid_term_withdrawal"
          && refund.withdrawalEffectiveOn?.slice(0, 7) === charge.billingPeriod
      ))
      .map((refund) => ({ receipt, refund }))
  })

  return events.sort((first, second) => {
    if (first.refund.lifecycle !== second.refund.lifecycle) {
      return first.refund.lifecycle === "recorded" ? -1 : 1
    }
    return second.refund.refundedOn.localeCompare(first.refund.refundedOn)
      || second.refund.id.localeCompare(first.refund.id)
  })[0] ?? null
}

function monthState(
  record: PlayerFeeRecord,
  period: string,
  charge: ChargeView | undefined,
) {
  if (!charge || charge.lifecycle === "void") {
    const agreement = record.feeAgreement
    const agreementStart = agreement?.effectiveFrom.slice(0, 7)
    const agreementEnd = agreement?.effectiveTo?.slice(0, 7)

    if (agreementStart && period < agreementStart) {
      return { detail: "", label: "Before plan", tone: "quiet" as const }
    }
    if (agreementEnd && period > agreementEnd) {
      return { detail: "", label: "Plan ended", tone: "quiet" as const }
    }
    return { detail: "", label: "Not issued", tone: "quiet" as const }
  }

  if (withdrawalForCharge(record, charge)) {
    return {
      detail: "Balance closed",
      label: "Closed after withdrawal",
      tone: "closed" as const,
    }
  }

  if (charge.status === "paid") {
    return {
      detail: formatFinanceAmount(charge.effectiveAmountPaise),
      label: "Paid",
      tone: "paid" as const,
    }
  }

  if (charge.status === "partially_paid") {
    return {
      detail: `${formatFinanceAmount(charge.outstandingPaise)} due`,
      label: "Partially paid",
      tone: "due" as const,
    }
  }

  if (charge.status === "pending" || charge.status === "overdue") {
    return {
      detail: `${formatFinanceAmount(charge.outstandingPaise)} due`,
      label: charge.status === "overdue" ? "Payment due" : "Pending",
      tone: "due" as const,
    }
  }

  return {
    detail: financeStatusLabel(charge.status),
    label: financeStatusLabel(charge.status),
    tone: "quiet" as const,
  }
}

function feeRecordHref(year: string, month: string | null) {
  const params = new URLSearchParams({ year })
  if (month) params.set("month", month)
  return `/player/financials?${params.toString()}`
}

function RegistrationBand({ record }: { record: PlayerFeeRecord }) {
  const charge = record.registrationCharge

  if (!charge || charge.lifecycle === "void" || record.registrationResolutionRequired) {
    return (
      <section
        className={styles.registrationEmpty}
        data-registration-state="preparing"
        aria-label="Registration fee"
      >
        <strong>Registration fee</strong>
        <p>Record being prepared</p>
      </section>
    )
  }

  const activeConcessionPaise = record.concessionEntries
    .filter((entry) => entry.chargeId === charge.id && entry.lifecycle === "applied")
    .reduce((total, entry) => total + entry.amountPaise, 0)
  const hasBalance = charge.outstandingPaise > 0
  const state = hasBalance
    ? { label: "Due", tone: "due" as const }
    : charge.receivedPaise > 0
      ? { label: "Paid", tone: "paid" as const }
      : activeConcessionPaise > 0
        ? { label: "Covered by concession", tone: "covered" as const }
        : { label: "Settled", tone: "paid" as const }
  const displayAmountPaise = hasBalance
    ? charge.outstandingPaise
    : charge.originalAmountPaise

  return (
    <section
      className={styles.registrationBand}
      data-registration-state={state.tone}
      data-state={state.tone}
      aria-labelledby="registration-fee-title"
    >
      <div className={styles.registrationIdentity}>
        <strong id="registration-fee-title">Registration fee</strong>
      </div>

      <div className={styles.registrationOutcome} data-tone={state.tone}>
        <span>{formatFinanceAmount(displayAmountPaise)}</span>
        <strong>{state.label}</strong>
      </div>
    </section>
  )
}

function MonthDetail({
  charge,
  period,
  receiptRows,
  record,
  wideRow,
  mobileRow,
}: {
  charge: ChargeView | null
  period: string
  receiptRows: ReceiptRow[]
  record: PlayerFeeRecord
  wideRow: number
  mobileRow: number
}) {
  const concessions = charge ? record.concessionEntries
    .filter((entry) => entry.chargeId === charge.id)
    .sort((first, second) => second.appliedOn.localeCompare(first.appliedOn))
    : []
  const activeConcessionPaise = concessions
    .filter((entry) => entry.lifecycle === "applied")
    .reduce((total, entry) => total + entry.amountPaise, 0)
  const withdrawal = charge ? withdrawalForCharge(record, charge) : null
  const activeWithdrawal = withdrawal?.refund.lifecycle === "recorded" ? withdrawal : null
  const grossReceivedPaise = charge?.payments
    .filter((payment) => payment.lifecycle === "recorded")
    .reduce((total, payment) => total + payment.amountPaise, 0) ?? 0
  const state = charge
    ? monthState(record, period, charge)
    : {
        label: `${receiptRows.length} ${receiptRows.length === 1 ? "receipt" : "receipts"} recorded`,
        tone: "quiet" as const,
      }
  const detailStyle = {
    "--detail-row-wide": wideRow,
    "--detail-row-mobile": mobileRow,
  } as CSSProperties

  return (
    <article
      className={styles.monthDetail}
      data-selected-fee-month={period}
      id={`fee-month-${period}`}
      style={detailStyle}
      aria-labelledby={`fee-month-${period}-title`}
    >
      <header className={styles.monthDetailHeader}>
        <div>
          <span>Selected month</span>
          <h2 id={`fee-month-${period}-title`}>
            {formatBillingPeriod(period)}
          </h2>
          <strong data-tone={state.tone}>{state.label}</strong>
        </div>

        {charge ? (
          <dl className={styles.monthFacts}>
            <div>
              <dt>Fee charged</dt>
              <dd>{formatFinanceAmount(charge.originalAmountPaise)}</dd>
            </div>
            {activeConcessionPaise > 0 ? (
              <div>
                <dt>Fee concession</dt>
                <dd>{formatFinanceAmount(activeConcessionPaise)}</dd>
              </div>
            ) : null}
            {withdrawal ? (
              <div>
                <dt>Offline paid</dt>
                <dd>{formatFinanceAmount(grossReceivedPaise)}</dd>
              </div>
            ) : (
              <div>
                <dt>Monthly fee received</dt>
                <dd>{formatFinanceAmount(charge.receivedPaise)}</dd>
              </div>
            )}
            {activeWithdrawal ? (
              <div>
                <dt>Unused-training credit</dt>
                <dd>{formatFinanceAmount(activeWithdrawal.refund.amountPaise)}</dd>
              </div>
            ) : null}
            {charge.outstandingPaise > 0 ? (
              <div data-tone="due">
                <dt>Remaining</dt>
                <dd>{formatFinanceAmount(charge.outstandingPaise)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Due date</dt>
              <dd><time dateTime={charge.dueDate}>{formatFinanceDate(charge.dueDate)}</time></dd>
            </div>
          </dl>
        ) : (
          <dl className={styles.monthFacts}>
            <div>
              <dt>Monthly fee</dt>
              <dd>Not issued</dd>
            </div>
          </dl>
        )}
      </header>

      {receiptRows.length || concessions.length || withdrawal ? (
        <div className={styles.monthHistory}>
          {receiptRows.map(({ receipt }) => (
            <section
              className={styles.historyEntry}
              data-fee-receipt-row={receipt.id}
              data-tone={receipt.lifecycle === "reversed" ? "quiet" : undefined}
              key={receipt.id}
            >
              <div className={styles.historyLead}>
                <span>{receiptKindLabel(receipt)} · {formatFinanceDate(receipt.receivedOn)}</span>
                <strong>{formatFinanceAmount(receipt.amountPaise)}</strong>
              </div>
              <div className={styles.receiptMetadata}>
                <ul className={styles.receiptMetaList} aria-label="Receipt details">
                  {receiptMeta(receipt).map((item) => <li key={item}>{item}</li>)}
                </ul>
                <ul className={styles.receiptAllocations} aria-label="Receipt allocations">
                  {receipt.allocations.map((allocation) => (
                    <li key={allocation.id}>
                      {receiptAllocationLabel(allocation)} — {formatFinanceAmount(allocation.amountPaise)}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}

          {concessions.map((entry) => (
            <section className={styles.historyEntry} data-tone={entry.lifecycle === "reversed" ? "quiet" : "credit"} key={entry.id}>
              <div className={styles.historyLead}>
                <span>{entry.label} · {formatFinanceDate(entry.appliedOn)}</span>
                <strong>{formatFinanceAmount(entry.amountPaise)}</strong>
              </div>
              <p>{entry.lifecycle === "reversed" ? "Concession reversed" : "Applied to this monthly fee"}</p>
            </section>
          ))}

          {withdrawal ? (
            <section className={styles.historyEntry} data-tone={withdrawal.refund.lifecycle === "recorded" ? "refund" : "quiet"}>
              <div className={styles.historyLead}>
                <span>
                  {withdrawal.refund.lifecycle === "recorded" ? "Refund issued" : "Refund reversed"}
                  {withdrawal.refund.withdrawalEffectiveOn ? ` · Withdrawal ${formatFinanceDate(withdrawal.refund.withdrawalEffectiveOn)}` : ""}
                </span>
                <strong>{formatFinanceAmount(withdrawal.refund.amountPaise)}</strong>
              </div>
              <p>
                {withdrawal.refund.refundReference} · {formatFinanceDate(withdrawal.refund.refundedOn)}
              </p>
            </section>
          ) : null}
        </div>
      ) : (
        <p className={styles.noHistory}>No offline payment has been recorded for this fee yet.</p>
      )}

      {charge ? (
        <footer className={styles.monthDetailFooter}>Fee reference {charge.feeReference}</footer>
      ) : null}
    </article>
  )
}

export function PlayerFeeRecordView({
  currentPeriod = getAcademyMonthKey(),
  record,
  requestedMonth,
  requestedYear,
}: {
  currentPeriod?: string
  record: PlayerFeeRecord
  requestedMonth?: string | null
  requestedYear?: string | null
}) {
  const chargeByPeriod = issuedChargeByPeriod(record.monthlyCharges)
  const receiptRowsByPeriod = receiptsByPeriod(record)
  const years = recordYears(record, currentPeriod)
  const issuedPeriods = [...chargeByPeriod.entries()]
    .filter(([, charge]) => charge.lifecycle === "issued")
    .map(([period]) => period)
  const activityPeriods = [...new Set([
    ...issuedPeriods,
    ...receiptRowsByPeriod.keys(),
  ])].sort()
  const activityYears = activityPeriods.map((period) => period.slice(0, 4))
  const defaultYear = activityYears.includes(currentPeriod.slice(0, 4))
    ? currentPeriod.slice(0, 4)
    : [...new Set(activityYears)].sort().at(-1) ?? currentPeriod.slice(0, 4)
  const hasRequestedYear = Boolean(requestedYear && years.includes(requestedYear))
  const selectedYear = hasRequestedYear ? requestedYear! : defaultYear
  const periodsInSelectedYear = activityPeriods
    .filter((period) => period.startsWith(`${selectedYear}-`))
  const selectedPeriod = requestedMonth
    && requestedMonth.startsWith(`${selectedYear}-`)
    && periodsInSelectedYear.includes(requestedMonth)
    ? requestedMonth
    : hasRequestedYear
      ? null
      : periodsInSelectedYear.at(-1) ?? null
  const selectedChargeCandidate = selectedPeriod ? chargeByPeriod.get(selectedPeriod) : null
  const selectedCharge = selectedChargeCandidate?.lifecycle === "issued"
    ? selectedChargeCandidate
    : null

  return (
    <div className={styles.feeRecord} data-player-fee-record>
      <section className={styles.seasonSummary} aria-label="Fee season summary">
        <div className={styles.yearControl}>
          <span>Fee season</span>
          <nav aria-label="Choose fee season" data-fee-year-selector>
            {years.map((year) => {
              const yearMonth = activityPeriods
                .filter((period) => period.startsWith(`${year}-`))
                .at(-1) ?? null

              return (
                <Link
                  aria-current={year === selectedYear ? "page" : undefined}
                  href={feeRecordHref(year, yearMonth)}
                  key={year}
                  scroll={false}
                >
                  {year}
                </Link>
              )
            })}
          </nav>
        </div>

        <dl className={styles.currentSummary}>
          <div>
            <dt>Current balance</dt>
            <dd>{formatFinanceAmount(record.currentBalancePaise)}</dd>
          </div>
          <div>
            <dt>Overall status</dt>
            <dd>{financeStatusLabel(record.status)}</dd>
          </div>
        </dl>
      </section>

      <RegistrationBand record={record} />

      <section className={styles.monthLedger} aria-label={`${selectedYear} monthly fee record`}>
        <div className={styles.monthGrid} data-fee-month-grid>
          {MONTHS.map((month, index) => {
            const period = `${selectedYear}-${month}`
            const charge = chargeByPeriod.get(period)
            const receiptRows = receiptRowsByPeriod.get(period) ?? []
            const state = monthState(record, period, charge)
            const isSelected = selectedPeriod === period
            const cellStyle = {
              "--month-column-wide": (index % 4) + 1,
              "--month-row-wide": Math.floor(index / 4) * 2 + 1,
              "--month-column-mobile": (index % 2) + 1,
              "--month-row-mobile": Math.floor(index / 2) * 2 + 1,
            } as CSSProperties
            const cellContent = (
              <>
                <span>{formatBillingPeriod(period).slice(0, 3)}</span>
                <strong>{state.label}</strong>
                {state.detail ? <small>{state.detail}</small> : receiptRows.length ? (
                  <small>{receiptRows.length} {receiptRows.length === 1 ? "receipt" : "receipts"}</small>
                ) : null}
              </>
            )

            if (charge?.lifecycle === "issued" || receiptRows.length) {
              return (
                <Link
                  aria-controls={isSelected ? `fee-month-${period}` : undefined}
                  aria-current={isSelected ? "true" : undefined}
                  aria-expanded={isSelected}
                  aria-label={`${isSelected ? "Collapse" : "View"} ${formatBillingPeriod(period)} ${selectedYear} fee details: ${state.label}${state.detail ? `, ${state.detail}` : ""}${receiptRows.length ? `, ${receiptRows.length} ${receiptRows.length === 1 ? "receipt" : "receipts"}` : ""}`}
                  className={styles.monthCell}
                  data-fee-month-cell={period}
                  data-fee-month-state={state.tone}
                  data-selected={isSelected || undefined}
                  data-tone={state.tone}
                  href={feeRecordHref(selectedYear, isSelected ? null : period)}
                  key={period}
                  scroll={false}
                  style={cellStyle}
                >
                  {cellContent}
                </Link>
              )
            }

            return (
              <div
                aria-label={`${formatBillingPeriod(period)}: ${state.detail || state.label}`}
                className={styles.monthCell}
                data-fee-month-cell={period}
                data-fee-month-state={state.tone}
                data-tone={state.tone}
                key={period}
                style={cellStyle}
              >
                {cellContent}
              </div>
            )
          })}

          {selectedPeriod ? (
            <MonthDetail
              charge={selectedCharge}
              mobileRow={Math.floor((Number(selectedPeriod.slice(5, 7)) - 1) / 2) * 2 + 2}
              period={selectedPeriod}
              receiptRows={receiptRowsByPeriod.get(selectedPeriod) ?? []}
              record={record}
              wideRow={Math.floor((Number(selectedPeriod.slice(5, 7)) - 1) / 4) * 2 + 2}
            />
          ) : null}
        </div>
      </section>
    </div>
  )
}
