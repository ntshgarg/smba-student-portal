"use client"

import Link from "next/link"
import { useEffect, useId, useMemo, useState } from "react"
import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react"

import {
  announcementDate,
  sortAnnouncements,
} from "@/components/announcements/announcement-presentation"
import type { AnnouncementSummary } from "@/components/announcements/types"
import styles from "@/components/announcements/announcements.module.css"

function announcementFromResponse(value: unknown): AnnouncementSummary | null {
  if (!value || typeof value !== "object") return null

  const announcement = value as Partial<AnnouncementSummary>
  if (
    typeof announcement.id !== "string"
    || !announcement.id
    || typeof announcement.title !== "string"
    || !announcement.title.trim()
    || typeof announcement.preview !== "string"
    || typeof announcement.publishedAt !== "string"
    || !Number.isFinite(Date.parse(announcement.publishedAt))
    || typeof announcement.pinned !== "boolean"
    || (announcement.expiresOn !== null && typeof announcement.expiresOn !== "string")
  ) return null

  return {
    id: announcement.id,
    title: announcement.title,
    preview: announcement.preview,
    publishedAt: announcement.publishedAt,
    expiresOn: announcement.expiresOn ?? null,
    pinned: announcement.pinned,
  }
}

function announcementsFromResponse(value: unknown) {
  if (!value || typeof value !== "object") return []

  const items = (value as { announcements?: unknown }).announcements
  if (!Array.isArray(items)) return []

  return items
    .map(announcementFromResponse)
    .filter((announcement): announcement is AnnouncementSummary => announcement !== null)
}

export function PublicAnnouncements() {
  const [announcements, setAnnouncements] = useState<AnnouncementSummary[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  const listId = useId()

  useEffect(() => {
    const controller = new AbortController()

    async function loadAnnouncements() {
      try {
        const response = await fetch("/api/public/announcements", {
          credentials: "omit",
          signal: controller.signal,
        })
        if (!response.ok) return

        const resolved = announcementsFromResponse(await response.json())
        if (!controller.signal.aborted) setAnnouncements(resolved)
      } catch {
        // Announcements are optional public content; the homepage remains complete without them.
      }
    }

    void loadAnnouncements()
    return () => controller.abort()
  }, [])

  const ordered = useMemo(
    () => announcements ? sortAnnouncements(announcements) : [],
    [announcements],
  )
  if (ordered.length === 0) return null

  const visible = expanded ? ordered : ordered.slice(0, 3)
  const hasMore = ordered.length > 3

  return (
    <section className={`section-shell ${styles.publicSection}`} aria-labelledby="public-announcements-title">
      <header className={styles.publicHeading}>
        <div>
          <p className="public-eyebrow">Announcements</p>
          <h2 id="public-announcements-title">From the academy.</h2>
        </div>
        <p>Current notices from SMBA, kept clear and easy to find.</p>
      </header>

      <div id={listId} className={styles.publicList}>
        {visible.map((announcement) => (
          <article className={styles.publicItem} key={announcement.id}>
            <div className={styles.publicMeta}>
              {announcement.pinned ? <span>Pinned</span> : null}
              <time dateTime={announcement.publishedAt}>
                {announcementDate(announcement.publishedAt)}
              </time>
            </div>
            <div className={styles.publicCopy}>
              <h3>
                <Link href={`/announcements/${announcement.id}`}>
                  {announcement.title}
                </Link>
              </h3>
              <p>{announcement.preview}</p>
            </div>
            <Link
              className={styles.publicOpen}
              href={`/announcements/${announcement.id}`}
              aria-label={`Read announcement: ${announcement.title}`}
            >
              Read
              <ArrowRight aria-hidden="true" />
            </Link>
          </article>
        ))}
      </div>

      {hasMore ? (
        <button
          className={styles.publicDisclosure}
          type="button"
          aria-controls={listId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show fewer announcements" : "Show all current announcements"}
          {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
      ) : null}
    </section>
  )
}
