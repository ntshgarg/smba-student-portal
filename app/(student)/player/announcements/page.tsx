import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft, Bell } from "lucide-react"

import { PlayerAnnouncementList } from "@/components/announcements/player-announcements"
import styles from "@/components/announcements/announcements.module.css"
import { PageIntro } from "@/components/page-intro"
import { listActivePlayerAnnouncements } from "@/lib/announcements/queries"
import { getCurrentStudent } from "@/lib/student/current-student"

export const metadata: Metadata = {
  title: "Announcements",
}
export default async function PlayerAnnouncementsPage() {
  const student = await getCurrentStudent()
  if (!student) redirect("/login")

  const announcements = await listActivePlayerAnnouncements(student.identity.playerId)

  return (
    <div className={`${styles.playerPage} interior-page page-shell`}>
      <div className={styles.playerToolbar}>
        <Link className="back-link" href="/player">
          <ArrowLeft aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>

      <PageIntro
        eyebrow="Announcements"
        title="Notices from the academy."
        body="Current updates from your coach, together in one quiet record."
      />

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
