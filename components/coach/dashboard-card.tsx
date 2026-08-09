import type { LucideIcon } from "lucide-react"
import { ArrowUpRight } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import styles from "./dashboard-card.module.css"

export function CoachDashboardStack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>
}

export function CoachDashboardCard({
  children,
  eyebrow,
  icon: Icon,
  sectionId,
  title,
  titleId,
}: {
  children: ReactNode
  eyebrow: string
  icon: LucideIcon
  sectionId?: string
  title: string
  titleId: string
}) {
  return (
    <section
      id={sectionId}
      className={`${styles.section} page-shell`}
      aria-labelledby={titleId}
    >
      <article className={styles.card}>
        <div className={styles.heading}>
          <span className={styles.icon} aria-hidden="true">
            <Icon />
          </span>
          <div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2 id={titleId}>{title}</h2>
          </div>
        </div>
        <div className={styles.meta}>{children}</div>
      </article>
    </section>
  )
}

export function CoachDashboardSummary({
  ariaLabel,
  children,
  detail,
  icon,
}: {
  ariaLabel?: string
  children: ReactNode
  detail?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className={styles.summary} aria-label={ariaLabel}>
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
    <div className={styles.group}>
      <p>{label}</p>
      {children}
    </div>
  )
}
