import Link from "next/link"
import { ArrowRight, ArrowUpRight, Pin } from "lucide-react"

import {
  announcementDate,
  announcementIsNew,
  sortAnnouncements,
} from "@/components/announcements/announcement-presentation"
import type { AnnouncementSummary } from "@/components/announcements/types"
import styles from "@/components/announcements/announcements.module.css"
import { Reveal } from "@/components/reveal"

function AnnouncementLabels({
  announcement,
  dashboard = false,
}: {
  announcement: AnnouncementSummary
  dashboard?: boolean
}) {
  const isNew = announcementIsNew(announcement.publishedAt)

  if (!announcement.pinned && !isNew) return null

  return (
    <span className={`${styles.labels}${dashboard ? ` ${styles.dashboardLabels}` : ""}`}>
      {announcement.pinned ? (
        dashboard
          ? <span>Pinned</span>
          : <><Pin aria-hidden="true" /><span className="sr-only">Pinned</span></>
      ) : null}
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
      <Reveal
        className={`${styles.dashboardCard} dashboard-card player-ticket-card player-ticket-announcements`}
        delay={0.08}
      >
        <header className="player-ticket-masthead">
          <h3 className="player-ticket-title">Announcements</h3>
          <span className="player-ticket-context" data-tone="attention">Unavailable</span>
        </header>
        <strong className="player-ticket-announcement-state">Announcements unavailable</strong>
        <p className={styles.dashboardUnavailableCopy}>
          Academy notices could not be loaded just now.
        </p>
      </Reveal>
    )
  }

  const ordered = sortAnnouncements(announcements)
  if (ordered.length === 0) {
    return (
      <Reveal
        className={`${styles.dashboardCard} dashboard-card player-ticket-card player-ticket-announcements`}
        delay={0.08}
      >
        <header className="player-ticket-masthead">
          <h3 className="player-ticket-title">Announcements</h3>
          <span className="player-ticket-context">Clear</span>
        </header>
        <div className={styles.dashboardEmpty} data-announcement-state="empty">
          <strong className={styles.dashboardEmptyTitle}>The notice board is clear.</strong>
          <p className={styles.dashboardEmptyCopy}>
            New notices from your coach will appear here when they are published.
          </p>
        </div>
      </Reveal>
    )
  }
  const visible = ordered.slice(0, 2)
  const isPair = visible.length === 2

  return (
    <Reveal
      className={`${styles.dashboardCard} dashboard-card player-ticket-card player-ticket-announcements`}
      delay={0.08}
    >
      <header className="player-ticket-masthead">
        <h3 className="player-ticket-title">Announcements</h3>
        <span className="player-ticket-context">
          {ordered.length} {ordered.length === 1 ? "notice" : "notices"}
        </span>
      </header>

      <div
        className={isPair ? styles.dashboardPairLayout : styles.dashboardFeatureLayout}
        data-announcement-layout={isPair ? "pair" : "single"}
      >
        <ol
          className={`${styles.dashboardNoticeList} ${isPair ? styles.dashboardPairList : styles.dashboardFeatureList}`}
          aria-label="Latest announcements"
        >
          {visible.map((announcement) => (
            <li className={styles.dashboardNoticeItem} key={announcement.id}>
              <Link
                className={styles.dashboardNotice}
                href={`/player/announcements/${announcement.id}`}
              >
                <span className={styles.dashboardNoticeMeta}>
                  <time dateTime={announcement.publishedAt}>
                    {announcementDate(announcement.publishedAt)}
                  </time>
                  <AnnouncementLabels announcement={announcement} dashboard />
                </span>
                <strong className={styles.dashboardNoticeTitle}>{announcement.title}</strong>
                <span className={styles.dashboardNoticeCopy}>{announcement.preview}</span>
              </Link>
            </li>
          ))}
        </ol>

        <Link
          className={`${styles.dashboardArchiveAction} player-ticket-action`}
          href="/player/announcements"
        >
          <span>Open all announcements</span>
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </div>
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
