import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft, Bell } from "lucide-react"

import { PlayerAnnouncementList } from "./announcement-list"
import styles from "@/components/announcements/announcements.module.css"
import { listActivePlayerAnnouncementDetails } from "@/lib/announcements/queries"
import { getCurrentStudent } from "@/lib/student/current-student"

export const metadata: Metadata = {
  title: "Announcements",
}
export default async function PlayerAnnouncementsPage() {
  const student = await getCurrentStudent()
  if (!student) redirect("/login")

  const announcements = listActivePlayerAnnouncementDetails(student.identity.playerId)

  return (
    <div className={styles.page}>
      <Link className="back-link" href="/player">
        <ArrowLeft aria-hidden="true" />
        Back to dashboard
      </Link>

      <h1 className={styles.title}>Announcements</h1>

      {announcements.length > 0 ? (
        <PlayerAnnouncementList announcements={announcements} />
      ) : (
        <section className="empty-state" aria-labelledby="player-announcements-empty-title">
          <Bell aria-hidden="true" />
          <h2 id="player-announcements-empty-title">No current announcements.</h2>
          <p>New notices from the academy will appear here when they are published.</p>
        </section>
      )}
    </div>
  )
}
