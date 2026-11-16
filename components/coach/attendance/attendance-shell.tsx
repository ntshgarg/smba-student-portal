import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import styles from "./attendance-shell.module.css"

export type AttendanceTab = "mark" | "register" | "makeups"

const TABS: Array<{ href: string; id: AttendanceTab; label: string }> = [
  { href: "/coach/attendance/players/record", id: "mark", label: "Mark" },
  { href: "/coach/attendance/players/register", id: "register", label: "Register" },
  { href: "/coach/attendance/adjustments", id: "makeups", label: "Make-ups" },
]

/**
 * The one Attendance page (head coach, 15 Nov 2026): players and staff, daily
 * marking, the register and make-ups under one heading. Each tab keeps the
 * address it always had, so links from the calendar, the dashboard and the
 * server's revalidation still land in the right place.
 */
export function AttendanceShell({
  activeTab,
  backHref = "/coach#attendance",
  backLabel = "Back to dashboard",
  children,
}: {
  activeTab: AttendanceTab
  backHref?: string
  backLabel?: string
  children: ReactNode
}) {
  return (
    <div className={`${styles.shell} page-shell`}>
      <nav className={styles.back} aria-label="Attendance navigation">
        <Link href={backHref}>
          <ArrowLeft aria-hidden="true" /> {backLabel}
        </Link>
      </nav>
      <h1 className={styles.title} id="attendance-title">Attendance</h1>
      <nav className={styles.tabs} aria-label="Attendance sections">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            aria-current={tab.id === activeTab ? "page" : undefined}
            className={tab.id === activeTab ? styles.active : undefined}
            href={tab.href}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  )
}
