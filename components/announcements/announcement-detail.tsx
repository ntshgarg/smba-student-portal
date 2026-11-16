import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import {
  announcementDate,
  announcementParagraphs,
} from "@/components/announcements/announcement-presentation"
import type { AnnouncementDetail } from "@/components/announcements/types"
import styles from "@/components/announcements/announcements.module.css"

/** The full message, a paragraph per blank line, keeping the single line breaks inside each. */
export function AnnouncementMessage({ content }: { content: string }) {
  return (
    <div className={styles.message}>
      {announcementParagraphs(content).map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
      ))}
    </div>
  )
}

export function AnnouncementDetailView({
  announcement,
  backHref,
  backLabel,
}: {
  announcement: AnnouncementDetail
  backHref: string
  backLabel: string
}) {
  return (
    <div className={styles.page}>
      <Link className="back-link" href={backHref}>
        <ArrowLeft aria-hidden="true" />
        {backLabel}
      </Link>

      <article className={styles.single}>
        <header className={styles.band}>
          <h1>{announcement.title}</h1>
          <time dateTime={announcement.publishedAt}>
            {announcementDate(announcement.publishedAt)}
          </time>
        </header>
        <div className={styles.singleBody}>
          <AnnouncementMessage content={announcement.content} />
        </div>
      </article>
    </div>
  )
}
