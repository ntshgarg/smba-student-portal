import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import styles from "./fees.module.css"

export type FeesTab = "fees" | "collections" | "activity"

const tabs: Array<{ label: string; value: FeesTab }> = [
  { label: "Register", value: "fees" },
  { label: "Collections", value: "collections" },
  { label: "Activity", value: "activity" },
]

/** Fees: the title, Record payment and the Register | Collections | Activity tabs. */
export function FeesShell({
  activeTab,
  children,
}: {
  activeTab: FeesTab
  children: ReactNode
}) {
  return (
    <div className={`${styles.page} page-shell`}>
      <div className={styles.back}>
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>
      <div className={styles.head}>
        <h1 className={styles.title}>Fees</h1>
        <Link className={styles.primary} href="/coach/financials/record">Record payment</Link>
      </div>
      <nav className={styles.tabs} aria-label="Fee views">
        {tabs.map(({ label, value }) => (
          <Link
            key={value}
            aria-current={activeTab === value ? "page" : undefined}
            href={`/coach/financials/records?view=${value}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  )
}
