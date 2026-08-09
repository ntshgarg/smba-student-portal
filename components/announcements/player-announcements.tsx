import Link from "next/link"
import { ArrowRight, Bell, Pin } from "lucide-react"

import {
  announcementDate,
  announcementIsNew,
  sortAnnouncements,
} from "@/components/announcements/announcement-presentation"
import type { AnnouncementSummary } from "@/components/announcements/types"
import styles from "@/components/announcements/announcements.module.css"
import { Reveal } from "@/components/reveal"

function AnnouncementLabels({ announcement }: { announcement: AnnouncementSummary }) {
  const isNew = announcementIsNew(announcement.publishedAt)

  if (!announcement.pinned && !isNew) return null

  return (
    <span className={styles.labels} aria-label={[
      announcement.pinned ? "Pinned" : null,
      isNew ? "New" : null,
    ].filter(Boolean).join(", ")}>
      {announcement.pinned ? <Pin aria-hidden="true" /> : null}
      {isNew ? <span>New</span> : null}
    </span>
  )
}

export function PlayerAnnouncementsCard({
  announcements,
}: {
  announcements: AnnouncementSummary[] | null
}) {
  if (announcements === null) {
    return (
      <Reveal className={`${styles.dashboardCard} dashboard-card`} delay={0.08}>
        <div className={styles.dashboardHeader}>
          <span className={styles.dashboardIcon} aria-hidden="true">
            <Bell />
          </span>
          <div>
            <p>Announcements</p>
            <h3 className={styles.dashboardUnavailableTitle}>Announcements unavailable</h3>
          </div>
        </div>
        <p className={styles.dashboardUnavailableCopy}>
          Academy notices could not be loaded just now.
        </p>
      </Reveal>
    )
  }

  const ordered = sortAnnouncements(announcements)
  if (ordered.length === 0) return null

  return (
    <Reveal className={`${styles.dashboardCard} dashboard-card`} delay={0.08}>
      <div className={styles.dashboardHeader}>
        <span className={styles.dashboardIcon} aria-hidden="true">
          <Bell />
        </span>
        <div>
          <p>Announcements</p>
          <h3>From the academy</h3>
        </div>
      </div>

      <div className={styles.dashboardList}>
        {ordered.slice(0, 2).map((announcement) => (
          <Link
            className={styles.dashboardItem}
            href={`/player/announcements/${announcement.id}`}
            key={announcement.id}
          >
            <span className={styles.dashboardItemCopy}>
              <span className={styles.dashboardItemMeta}>
                <time dateTime={announcement.publishedAt}>
                  {announcementDate(announcement.publishedAt)}
                </time>
                <AnnouncementLabels announcement={announcement} />
              </span>
              <strong>{announcement.title}</strong>
              <span>{announcement.preview}</span>
            </span>
            <ArrowRight aria-hidden="true" />
          </Link>
        ))}
      </div>

      {ordered.length > 2 ? (
        <Link className={styles.dashboardAll} href="/player/announcements">
          View all announcements
          <ArrowRight aria-hidden="true" />
        </Link>
      ) : null}
    </Reveal>
  )
}

export function PlayerAnnouncementList({
  announcements,
}: {
  announcements: AnnouncementSummary[]
}) {
  const ordered = sortAnnouncements(announcements)

  return (
    <section className={styles.playerList} aria-label="Current announcements">
      {ordered.map((announcement) => (
        <article className={styles.playerListItem} key={announcement.id}>
          <div className={styles.playerListMeta}>
            <time dateTime={announcement.publishedAt}>
              {announcementDate(announcement.publishedAt)}
            </time>
            <AnnouncementLabels announcement={announcement} />
          </div>
          <h2>
            <Link href={`/player/announcements/${announcement.id}`}>
              {announcement.title}
            </Link>
          </h2>
          <p>{announcement.preview}</p>
          <Link
            className={styles.playerListOpen}
            href={`/player/announcements/${announcement.id}`}
            aria-label={`Read announcement: ${announcement.title}`}
          >
            Read announcement
            <ArrowRight aria-hidden="true" />
          </Link>
        </article>
      ))}
    </section>
  )
}
