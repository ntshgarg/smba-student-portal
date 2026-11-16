"use client"

import Link from "next/link"
import { useState } from "react"
import { ChevronDown } from "lucide-react"

import { AnnouncementMessage } from "@/components/announcements/announcement-detail"
import {
  announcementDay,
  announcementIsNew,
  sortAnnouncements,
} from "@/components/announcements/announcement-presentation"
import type { AnnouncementDetail } from "@/components/announcements/types"
import styles from "@/components/announcements/announcements.module.css"

/** One row per notice, pinned first; a row opens in place to the full message, one at a time. */
export function PlayerAnnouncementList({ announcements }: { announcements: AnnouncementDetail[] }) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <ul className={styles.panel} aria-label="Current announcements">
      {sortAnnouncements(announcements).map((announcement) => {
        const isOpen = openId === announcement.id
        const isNew = announcement.isNew ?? announcementIsNew(announcement.publishedAt)
        const { day, month } = announcementDay(announcement.publishedAt)
        const bodyId = `announcement-${announcement.id}`

        return (
          <li className={isOpen ? styles.open : undefined} key={announcement.id}>
            <h2>
              <button
                className={styles.rowHead}
                type="button"
                aria-expanded={isOpen}
                aria-controls={bodyId}
                onClick={() => setOpenId(isOpen ? null : announcement.id)}
              >
                <time className={styles.date} dateTime={announcement.publishedAt}>
                  {Number(day)} {month}
                </time>
                <span className={styles.rowTitle}>{announcement.title}</span>
                {isNew ? <span className={styles.tag}>New</span> : null}
                <ChevronDown className={styles.chevron} aria-hidden="true" />
              </button>
            </h2>
            <div className={styles.rowBody} id={bodyId} hidden={!isOpen}>
              <AnnouncementMessage content={announcement.content} />
              <Link className={styles.pageLink} href={`/player/announcements/${announcement.id}`}>
                Open on its own page
              </Link>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
