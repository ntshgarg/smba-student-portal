"use client"

import type { ReactNode } from "react"

import styles from "@/components/coach/members/directory/member-training-actions.module.css"

/**
 * The frame every confirm-before-saving form on a player's record uses, and
 * End schedule in Schedules & rosters: the choice in the body, then "You are
 * about to" with exactly what will happen, then Cancel and the one button
 * that does it.
 */
export function FormShell({
  backLabel,
  busy,
  children,
  confirmLabel,
  danger = false,
  disabled = false,
  eyebrow,
  onCancel,
  onConfirm,
  summary,
  title,
}: {
  /** On a player's record, the tab the form came from: a pill back to it, which cancels. */
  backLabel?: string
  busy: boolean
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  disabled?: boolean
  eyebrow: string
  onCancel: () => void
  onConfirm: () => void
  summary: string[]
  title: string
}) {
  return (
    <div className={styles.form} role="group" aria-label={title}>
      <div className={styles.formHead}>
        {backLabel ? (
          <button className={styles.back} aria-label={`Back to ${backLabel}`} disabled={busy} onClick={onCancel} type="button">
            <span aria-hidden="true">‹</span> {backLabel}
          </button>
        ) : (
          <span className={styles.eyebrow}>{eyebrow}</span>
        )}
        <h4>{title}</h4>
      </div>
      <div className={styles.formBody}>
        {children}
        {summary.length ? (
          <div className={styles.summary}>
            <span>You are about to</span>
            <ul>{summary.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        ) : null}
      </div>
      <div className={styles.formFoot}>
        <button className={styles.button} disabled={busy} onClick={onCancel} type="button">Cancel</button>
        <button
          className={`${styles.button} ${danger ? styles.dangerSolid : styles.primary}`}
          disabled={busy || disabled}
          onClick={onConfirm}
          type="button"
        >
          {busy ? "Saving…" : confirmLabel}
        </button>
      </div>
    </div>
  )
}
