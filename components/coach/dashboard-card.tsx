import { ArrowUpRight } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import styles from "./dashboard-card.module.css"

export type CoachDashboardArea =
  | "onboarding"
  | "attendance"
  | "sessions"
  | "reports"
  | "financials"
  | "announcements"
  | "members"

/**
 * The status stamp has exactly two shapes so a coach can scan the column of
 * cards instead of reading each one: a number with the lowercase qualifier
 * that says what it counts, or one of two capitalised state words used when no
 * number would say anything — `Clear` for nothing outstanding and `Setup` for
 * an area that is not configured yet. The attention tone belongs to the count
 * shape only, because it marks a backlog.
 */
export type CoachDashboardStatus =
  | { count: number; unit: string; tone?: "attention" }
  | { state: "Clear" | "Setup" }

function statusStamp(status: CoachDashboardStatus) {
  return "state" in status ? status.state : `${status.count} ${status.unit}`
}

export function CoachDashboardStack({
  children,
  id,
}: {
  children: ReactNode
  id?: string
}) {
  return (
    <div id={id} className={`${styles.stack} page-shell`} data-coach-dashboard-grid>
      {children}
    </div>
  )
}

export function CoachDashboardCard({
  area,
  children,
  id,
  status,
  title,
  titleId,
}: {
  area: CoachDashboardArea
  children: ReactNode
  id?: string
  status?: CoachDashboardStatus
  title: string
  titleId: string
}) {
  return (
    <section
      id={id}
      className={styles.section}
      data-area={area}
      aria-labelledby={titleId}
    >
      <article className={styles.card}>
        <header className={styles.masthead}>
          <h2 id={titleId}>{title}</h2>
          {status ? (
            <span
              className={styles.status}
              data-tone={"state" in status ? undefined : status.tone}
            >
              {statusStamp(status)}
            </span>
          ) : null}
        </header>
        <div className={styles.meta}>{children}</div>
      </article>
    </section>
  )
}

export function CoachDashboardSummary({
  children,
  detail,
  icon,
}: {
  children: ReactNode
  detail?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className={styles.summary}>
      <p>
        {icon ? <span className={styles.summaryIcon}>{icon}</span> : null}
        <span>{children}</span>
      </p>
      {detail ? <span className={styles.summaryDetail}>{detail}</span> : null}
    </div>
  )
}

export function CoachDashboardActions({
  ariaLabel,
  children,
}: {
  ariaLabel: string
  children: ReactNode
}) {
  return (
    <nav className={styles.actions} aria-label={ariaLabel}>
      {children}
    </nav>
  )
}

export function CoachDashboardAction({
  children,
  href,
}: {
  children: ReactNode
  href: string
}) {
  return (
    <Link className={styles.action} href={href}>
      {children}
      <ArrowUpRight aria-hidden="true" />
    </Link>
  )
}

export function CoachDashboardSecondaryAction({
  children,
  href,
}: {
  children: ReactNode
  href: string
}) {
  return (
    <Link className={`${styles.action} ${styles.secondaryAction}`} href={href}>
      {children}
      <ArrowUpRight aria-hidden="true" />
    </Link>
  )
}

export function CoachDashboardGroups({ children }: { children: ReactNode }) {
  return <div className={styles.groups}>{children}</div>
}

export function CoachDashboardGroup({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <div className={styles.group} role="group" aria-label={label}>
      <p>{label}</p>
      {children}
    </div>
  )
}
