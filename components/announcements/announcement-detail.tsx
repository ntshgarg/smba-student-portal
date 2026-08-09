import Link from "next/link"
import { ArrowLeft, Pin } from "lucide-react"

import {
  announcementDate,
  announcementParagraphs,
} from "@/components/announcements/announcement-presentation"
import type { AnnouncementDetail } from "@/components/announcements/types"
import styles from "@/components/announcements/announcements.module.css"

export function AnnouncementDetailView({
  announcement,
  backHref,
  backLabel,
  publicView = false,
}: {
  announcement: AnnouncementDetail
  backHref: string
  backLabel: string
  publicView?: boolean
}) {
  return (
    <article className={publicView ? styles.publicDetail : styles.playerDetail}>
      <Link className={publicView ? styles.publicBack : "back-link"} href={backHref}>
        <ArrowLeft aria-hidden="true" />
        {backLabel}
      </Link>

      <header className={styles.detailHeading}>
        <div className={styles.detailMeta}>
          <p>Announcement</p>
          {announcement.pinned ? (
            <span>
              <Pin aria-hidden="true" />
              Pinned
            </span>
          ) : null}
        </div>
        <h1>{announcement.title}</h1>
        <time dateTime={announcement.publishedAt}>
          Published {announcementDate(announcement.publishedAt)}
        </time>
      </header>

      <div className={styles.detailMessage}>
        {announcementParagraphs(announcement.content).map((paragraph, index) => (
          <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
        ))}
      </div>
    </article>
  )
}
