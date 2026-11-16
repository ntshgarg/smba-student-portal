"use client"

import { X } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { formatDateKey, formatInr } from "@/lib/format"
import type { FinanceRegisterRow, FinanceStatus } from "@/lib/finance/types"

import styles from "./fees.module.css"

export type FeeRegisterListRow = FinanceRegisterRow & {
  /** The desk, opened on this player; only while this fee has money left on it. */
  paymentHref: string | null
  recordHref: string
}

const statusLabels: Record<FinanceStatus, string> = {
  not_prepared: "To issue",
  overdue: "Overdue",
  paid: "Paid",
  partially_paid: "Part paid",
  pending: "Due",
  setup_required: "No fee plan",
  void: "Void",
}

function shortDate(dateKey: string) {
  return formatDateKey(dateKey, { day: "numeric", month: "short", weekday: undefined })
}

function initials(name: string) {
  return name.split(/\s+/u).slice(0, 2).map((part) => part[0]).join("")
}

/** The amount a row leads with and the few words under it. */
function rowAmount(row: FinanceRegisterRow) {
  if (row.status === "not_prepared") return { amount: "—", detail: "not issued yet" }
  if (row.status === "setup_required") return { amount: "—", detail: "no fee plan" }
  if (row.status === "void") return { amount: formatInr(0), detail: "voided" }
  if (row.status === "paid") return { amount: formatInr(row.effectiveAmountPaise), detail: "paid in full" }
  return {
    amount: formatInr(row.outstandingPaise),
    detail: row.dueDate ? `due ${shortDate(row.dueDate)}` : "due",
  }
}

function rowNote(row: FinanceRegisterRow) {
  const adjustments = [
    row.creditAdjustmentsPaise ? `${formatInr(row.creditAdjustmentsPaise)} credit` : null,
    row.debitAdjustmentsPaise ? `${formatInr(row.debitAdjustmentsPaise)} debit` : null,
  ].filter(Boolean).join(" · ")
  const due = row.dueDate
    ? `Due ${formatDateKey(row.dueDate, { day: "numeric", month: "short", weekday: undefined, year: "numeric" })}`
    : row.status === "setup_required"
      ? "On a schedule with no fee plan"
      : "No charge issued"
  return [row.feeReference, due, adjustments || null].filter(Boolean).join(" · ")
}

/** The register's players: one opens in place at a time. */
export function FeeRegisterList({
  rows,
  startNumber,
}: {
  rows: FeeRegisterListRow[]
  /** Where this page starts in the whole list, for screen-reader row labels. */
  startNumber: number
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <ol className={styles.rows} start={startNumber}>
      {rows.map((row) => {
        const open = openId === row.playerId
        const { amount, detail } = rowAmount(row)
        const bodyId = `fee-row-${row.playerId}`
        return (
          <li key={`${row.playerId}-${row.feeReference ?? row.status}`} className={`${styles.row} ${open ? styles.openRow : ""}`}>
            <button
              type="button"
              className={styles.rowHead}
              aria-expanded={open}
              aria-controls={open ? bodyId : undefined}
              onClick={() => setOpenId(open ? null : row.playerId)}
            >
              {open ? null : <span className={styles.badge} aria-hidden="true">{initials(row.fullName)}</span>}
              <span className={styles.who}>
                <strong>{row.fullName}</strong>
                <small>{row.academyId}{row.archived ? " · Archived" : ""}</small>
              </span>
              {open ? (
                <span className={styles.close} aria-hidden="true"><X /></span>
              ) : (
                <>
                  <span className={styles.money}>
                    <span className={styles.pill} data-status={row.status}>{statusLabels[row.status]}</span>
                    <span className={styles.amount}>{amount}<small>{detail}</small></span>
                  </span>
                  <span className={styles.chev} aria-hidden="true" />
                </>
              )}
            </button>
            {open ? (
              <div className={styles.rowBody} id={bodyId}>
                <dl className={styles.facts}>
                  <div><dt>Charged</dt><dd>{formatInr(row.effectiveAmountPaise)}</dd></div>
                  <div><dt>Received</dt><dd>{formatInr(row.receivedPaise)}</dd></div>
                  <div className={row.outstandingPaise > 0 ? styles.owedFact : undefined}>
                    <dt>Left</dt><dd>{formatInr(row.outstandingPaise)}</dd>
                  </div>
                </dl>
                <p className={styles.note}>
                  <span className={styles.pill} data-status={row.status}>{statusLabels[row.status]}</span>{" "}
                  {rowNote(row)}
                </p>
                <div className={styles.actions}>
                  <Link className={styles.button} href={row.recordHref}>Full fee record</Link>
                  {row.paymentHref ? (
                    <Link className={styles.primary} href={row.paymentHref}>Record payment</Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
