"use client"

import Link from "next/link"
import { useEffect, useId, useMemo, useState } from "react"
import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react"

import {
  announcementDate,
  announcementDay,
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

  // Pinned notices sort first, then the newest; two show, and the rest open in place
  const shown = expanded ? ordered : ordered.slice(0, 2)
  const waiting = ordered.length - 2

  return (
    <section className={`section-shell ${styles.publicSection}`} aria-labelledby="public-announcements-title">
      <div className="section-intro">
        <p className="public-eyebrow">Announcements</p>
        <h2 id="public-announcements-title">From the academy.</h2>
        <p className="body-muted">Current notices from SMBA, kept clear and easy to find.</p>
      </div>

      <div id={listId} className={styles.publicNotices}>
        {shown.map((announcement) => {
          const { day, month } = announcementDay(announcement.publishedAt)
          return (
            <article className={styles.publicNotice} key={announcement.id}>
              <span className={styles.publicDay} aria-hidden="true">
                <span>{month}</span>
                <span>{day}</span>
              </span>
              <NoticeMeta announcement={announcement} />
              <h3>
                <Link href={`/announcements/${announcement.id}`}>{announcement.title}</Link>
              </h3>
              <p>{announcement.preview}</p>
              <Link
                className={styles.publicOpen}
                href={`/announcements/${announcement.id}`}
                aria-label={`Read announcement: ${announcement.title}`}
              >
                Read
                <ArrowRight aria-hidden="true" />
              </Link>
            </article>
          )
        })}
      </div>

      {waiting > 0 ? (
        <button
          className={styles.publicDisclosure}
          type="button"
          aria-controls={listId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "See fewer" : `See more (${waiting})`}
          {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
      ) : null}
    </section>
  )
}

function NoticeMeta({ announcement }: { announcement: AnnouncementSummary }) {
  return (
    <div className={styles.publicMeta}>
      {announcement.pinned ? <span>Pinned</span> : null}
      <time dateTime={announcement.publishedAt}>{announcementDate(announcement.publishedAt)}</time>
    </div>
  )
}
