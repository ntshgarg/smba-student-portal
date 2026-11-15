import { ArrowUpRight } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import styles from "./dashboard-card.module.css"

export type CoachDashboardArea =
  | "todo"
  | "onboarding"
  | "attendance"
  | "sessions"
  | "reports"
  | "financials"
  | "announcements"
  | "members"

/**
 * The status stamp appears only when it has something to say, so a stamp always
 * means "look here": a number with the lowercase qualifier that says what it
 * counts, or `Setup` for an area that is not configured yet. A card with nothing
 * outstanding has no stamp (there used to be a `Clear`, which sat beside
 * "0 of 32 assessed" and read as all fine). The one exception is Attendance's
 * `All marked`, agreed for the day's registers (15 Nov 2026): it sits beside
 * "N of N sessions marked", which it agrees with. The attention tone belongs to
 * the count shape only, because it marks a backlog.
 */
export type CoachDashboardStatus =
  | {
    count: number
    unit: string
    tone?: "attention"
    /** the list behind the count, so tapping the stamp shows exactly those records */
    href?: string
    /** what the link opens, for screen readers; starts with the visible words ("14 overdue: show these players") */
    linkLabel?: string
  }
  | { state: "Setup" | "All marked" }

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
  /** one stamp, or several side by side (Financials: fees to issue, then overdue) */
  status?: CoachDashboardStatus | CoachDashboardStatus[]
  title: string
  titleId: string
}) {
  const stamps = status ? [status].flat() : []

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
          {stamps.length ? (
            <span className={styles.statuses}>
              {stamps.map((stamp) => "href" in stamp && stamp.href ? (
                <Link
                  key={statusStamp(stamp)}
                  className={styles.statusLink}
                  href={stamp.href}
                  aria-label={stamp.linkLabel}
                >
                  <span className={styles.status} data-tone={stamp.tone}>{statusStamp(stamp)}</span>
                </Link>
              ) : (
                <span
                  key={statusStamp(stamp)}
                  className={styles.status}
                  data-tone={"state" in stamp ? undefined : stamp.tone}
                >
                  {statusStamp(stamp)}
                </span>
              ))}
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

/** `primary` marks the one action for something waiting on the coach (the card has a red stamp): a filled navy button. */
export function CoachDashboardAction({
  children,
  href,
  primary = false,
}: {
  children: ReactNode
  href: string
  primary?: boolean
}) {
  return (
    <Link className={primary ? `${styles.action} ${styles.primaryAction}` : styles.action} href={href}>
      {children}
      <ArrowUpRight aria-hidden="true" />
    </Link>
  )
}
