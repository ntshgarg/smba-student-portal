import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import styles from "./sessions.module.css"

export type SessionsTab = "calendar" | "schedules"

const TABS: Array<{ href: string; id: SessionsTab; label: string }> = [
  { href: "/coach/calendar", id: "calendar", label: "Calendar" },
  { href: "/coach/schedules", id: "schedules", label: "Schedules" },
]

/**
 * The one Sessions page (head coach, 16 Nov 2026): the calendar and the
 * schedules under one heading, each tab keeping the address it always had.
 * `action` sits on the right of the tabs: Create schedule on Schedules.
 */
export function SessionsShell({
  action,
  activeTab,
  children,
}: {
  action?: ReactNode
  activeTab: SessionsTab
  children: ReactNode
}) {
  return (
    <div className={`${styles.page} page-shell`}>
      <nav className={styles.back} aria-label="Sessions navigation">
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </nav>
      <h1 className={styles.title}>Sessions</h1>
      <div className={styles.tabRow}>
        <nav className={styles.tabs} aria-label="Sessions sections">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              aria-current={tab.id === activeTab ? "page" : undefined}
              href={tab.href}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {action}
      </div>
      {children}
    </div>
  )
}
