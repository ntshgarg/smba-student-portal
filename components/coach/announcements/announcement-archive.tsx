"use client"

import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import {
  AnnouncementBody,
  lastDayLabel,
  shortDayLabel,
  whereItShows,
} from "./announcement-detail"
import type {
  AnnouncementChannel,
  AnnouncementStatus,
  CoachAnnouncementDetail,
} from "./contracts"
import styles from "./announcements.module.css"

export type AnnouncementArchiveQuery = {
  channel?: AnnouncementChannel | "all"
  month: string
  query?: string
  status?: AnnouncementStatus | "all"
}

function shiftMonth(month: string, offset: number) {
  const [year, monthIndex] = month.split("-").map(Number)
  const value = new Date(Date.UTC(year, monthIndex - 1 + offset, 1))
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`
}

const monthFormat = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

function formatMonth(month: string) {
  const [year, monthIndex] = month.split("-").map(Number)
  return monthFormat.format(new Date(Date.UTC(year, monthIndex - 1, 1)))
}

function archiveHref(
  values: AnnouncementArchiveQuery,
  updates: Partial<AnnouncementArchiveQuery> = {},
) {
  const next = { ...values, ...updates }
  const parameters = new URLSearchParams({ month: next.month })
  if (next.query?.trim()) parameters.set("q", next.query.trim())
  if (next.status && next.status !== "all") parameters.set("status", next.status)
  if (next.channel && next.channel !== "all") parameters.set("channel", next.channel)
  return `/coach/announcements?${parameters.toString()}`
}

/** Pinned and Expired are quiet words; only a withdrawal is marked. */
function rowState(announcement: CoachAnnouncementDetail) {
  if (announcement.status === "withdrawn") return <span className={styles.tag}>Withdrawn</span>
  if (announcement.status === "expired") return "Expired"
  // Pinning only orders live notices.
  return announcement.pinned ? "Pinned" : null
}

export function PublishedAnnouncementArchive({
  announcements,
  currentMonth,
  firstMonth = null,
  hasPublishedAnnouncements,
  query,
  stillShowing = [],
}: {
  announcements: CoachAnnouncementDetail[]
  currentMonth: string
  /** The month of the first announcement ever published; nothing exists before it. */
  firstMonth?: string | null
  hasPublishedAnnouncements: boolean
  query: AnnouncementArchiveQuery
  /** Live notices published before this month, shown at the top of the current month. */
  stillShowing?: CoachAnnouncementDetail[]
}) {
  const monthLabel = formatMonth(query.month)
  const nextDisabled = query.month >= currentMonth
  const previousDisabled = firstMonth !== null && query.month <= firstMonth
  const filtersActive = query.status !== "all" || query.channel !== "all"
  const [filtersOpen, setFiltersOpen] = useState(filtersActive)
  // One announcement open at a time, in place.
  const [openId, setOpenId] = useState<string | null>(null)
  // Live notices from earlier months lead the current month, as the dashboard counts them.
  const rows = [...stillShowing, ...announcements]
  const panelRef = useRef<HTMLElement>(null)
  // What the last pin or withdrawal did, said only once the refresh drops its row.
  const [lastOutcome, setLastOutcome] = useState<{ id: string; message: string } | null>(null)
  const listed = (id: string | null) => rows.some((row) => row.id === id)
  const outcome = lastOutcome && !listed(lastOutcome.id) ? lastOutcome.message : ""
  const openRowGone = openId !== null && !listed(openId)

  // A status filter or the earlier-month list can drop the open row once it is
  // withdrawn or unpinned; keep focus in the list rather than on the page.
  useEffect(() => {
    if (openRowGone) panelRef.current?.focus()
  }, [openRowGone])

  return (
    <div className={`${styles.page} page-shell`}>
      <nav className={styles.back} aria-label="Announcements navigation">
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </nav>

      <div className={styles.titleRow}>
        <h1 className={styles.title}>Announcements</h1>
        {hasPublishedAnnouncements ? (
          <Link className={styles.primary} href="/coach/announcements/new">New announcement</Link>
        ) : null}
      </div>

      {!hasPublishedAnnouncements ? (
        <section className={styles.panel} aria-labelledby="announcement-empty-title">
          <div className={styles.empty}>
            <h2 id="announcement-empty-title">No announcements yet.</h2>
            <p>Published notices stay here for you to look back on.</p>
            <Link className={styles.link} href="/coach/announcements/new">Write the first announcement</Link>
          </div>
        </section>
      ) : (
        <section
          ref={panelRef}
          className={styles.panel}
          aria-labelledby="announcement-archive-title"
          tabIndex={-1}
        >
          <div className={styles.toolbar}>
            <div className={styles.monthNav} role="group" aria-label="Choose announcement month">
              {previousDisabled ? (
                <span aria-hidden="true"><ChevronLeft /></span>
              ) : (
                <Link
                  href={archiveHref(query, { month: shiftMonth(query.month, -1) })}
                  aria-label={`Show ${formatMonth(shiftMonth(query.month, -1))}`}
                >
                  <ChevronLeft aria-hidden="true" />
                </Link>
              )}
              <h2 id="announcement-archive-title">{monthLabel}</h2>
              {nextDisabled ? (
                <span aria-hidden="true"><ChevronRight /></span>
              ) : (
                <Link
                  href={archiveHref(query, { month: shiftMonth(query.month, 1) })}
                  aria-label={`Show ${formatMonth(shiftMonth(query.month, 1))}`}
                >
                  <ChevronRight aria-hidden="true" />
                </Link>
              )}
            </div>

            <form className={styles.search} action="/coach/announcements" method="get" role="search">
              <input name="month" type="hidden" value={query.month} />
              <input name="status" type="hidden" value={query.status === "all" ? "" : query.status} />
              <input name="channel" type="hidden" value={query.channel === "all" ? "" : query.channel} />
              <label className="sr-only" htmlFor="announcement-search">Find an announcement</label>
              <input
                autoComplete="off"
                defaultValue={query.query}
                id="announcement-search"
                maxLength={120}
                name="q"
                placeholder="Search"
                type="search"
              />
            </form>

            <button
              className={styles.button}
              type="button"
              aria-controls="announcement-filters"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              {filtersActive ? "Filter · on" : "Filter"}
            </button>
          </div>

          <form
            className={styles.filters}
            id="announcement-filters"
            action="/coach/announcements"
            method="get"
            hidden={!filtersOpen}
          >
            <input name="month" type="hidden" value={query.month} />
            <input name="q" type="hidden" value={query.query} />
            <label>
              <span>Status</span>
              <select defaultValue={query.status} name="status">
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </label>
            <label>
              <span>Shows on</span>
              <select defaultValue={query.channel} name="channel">
                <option value="all">Anywhere</option>
                <option value="homepage">Homepage</option>
                <option value="player_dashboard">Player home</option>
              </select>
            </label>
            <div className={styles.actions}>
              <button className={styles.button} type="submit">Apply</button>
              {filtersActive
                ? <Link className={styles.link} href={archiveHref(query, { channel: "all", status: "all" })}>Clear</Link>
                : null}
            </div>
          </form>

          {query.query || filtersActive ? (
            <div className={styles.resultBar} aria-live="polite">
              <p>{rows.length} {rows.length === 1 ? "result" : "results"}</p>
              {query.query ? <Link className={styles.link} href={archiveHref(query, { query: "" })}>Clear search</Link> : null}
            </div>
          ) : null}

          <p className={styles.outcome} aria-live="polite">{outcome}</p>

          {rows.length === 0 ? (
            <div className={styles.empty}>
              <h3>No matching announcements.</h3>
              <p>Try another month, search, or filter.</p>
              <Link
                className={styles.link}
                href={archiveHref({ month: query.month, status: "all", channel: "all", query: "" })}
              >
                Clear search and filters
              </Link>
            </div>
          ) : (
            <ol className={styles.rows} aria-label={`${monthLabel} announcements`}>
              {rows.map((announcement) => {
                const open = openId === announcement.id
                const detailId = `announcement-${announcement.id}`
                return (
                  <li
                    key={announcement.id}
                    className={open ? styles.open : undefined}
                    data-status={announcement.status}
                  >
                    <h3>
                      <button
                        className={styles.rowHead}
                        type="button"
                        aria-controls={detailId}
                        aria-expanded={open}
                        onClick={() => {
                          setLastOutcome(null)
                          setOpenId(open ? null : announcement.id)
                        }}
                      >
                        <time className={styles.date} dateTime={announcement.publishedAt}>
                          {shortDayLabel(announcement.publishedAt)}
                        </time>
                        <span className={styles.copy}>
                          <strong>{announcement.title}</strong>
                          <small>
                            {whereItShows(announcement.channels)}
                            {announcement.expiresOn ? ` · until ${lastDayLabel(announcement.expiresOn)}` : ""}
                          </small>
                        </span>
                        <span className={styles.state}>{rowState(announcement)}</span>
                        <ChevronRight className={styles.chevron} aria-hidden="true" />
                      </button>
                    </h3>
                    {/* Kept mounted while closed, so a pin or withdrawal still
                        in flight keeps its reason and has a notice to land on. */}
                    <div className={styles.detail} id={detailId} hidden={!open}>
                      <AnnouncementBody
                        announcement={announcement}
                        onDone={(verb) => setLastOutcome({
                          id: announcement.id,
                          message: `${announcement.title} was ${verb}.`,
                        })}
                      />
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      )}
    </div>
  )
}
