import {
  ArrowLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Filter,
  Megaphone,
  Pin,
  Search,
} from "lucide-react"
import Link from "next/link"

import { formatAcademyDate } from "@/lib/format"

import {
  announcementChannelLabel,
  announcementStatusLabel,
  type AnnouncementChannel,
  type AnnouncementStatus,
  type CoachAnnouncementSummary,
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

function formatMonth(month: string) {
  const [year, monthIndex] = month.split("-").map(Number)
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex - 1, 1)))
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

function detailHref(id: string, query: AnnouncementArchiveQuery) {
  const parameters = new URLSearchParams({ month: query.month })
  if (query.query?.trim()) parameters.set("q", query.query.trim())
  if (query.status && query.status !== "all") parameters.set("status", query.status)
  if (query.channel && query.channel !== "all") parameters.set("channel", query.channel)
  return `/coach/announcements/${encodeURIComponent(id)}?${parameters.toString()}`
}

export function PublishedAnnouncementArchive({
  announcements,
  currentMonth,
  hasPublishedAnnouncements,
  query,
}: {
  announcements: CoachAnnouncementSummary[]
  currentMonth: string
  hasPublishedAnnouncements: boolean
  query: AnnouncementArchiveQuery
}) {
  const monthLabel = formatMonth(query.month)
  const nextDisabled = query.month >= currentMonth
  const filtersActive = query.status !== "all" || query.channel !== "all"

  return (
    <div className={`${styles.workspace} page-shell`}>
      <div className={styles.backRow}>
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>

      <header className={styles.archiveHeader}>
        <div>
          <span className="eyebrow">Announcements</span>
          <h1>Published announcements</h1>
          <p>Review the notices already shared with the academy.</p>
        </div>

        {hasPublishedAnnouncements ? (
          <div className={styles.monthControl} aria-label="Choose announcement month">
            <Link
              href={archiveHref(query, { month: shiftMonth(query.month, -1) })}
              aria-label={`Show ${formatMonth(shiftMonth(query.month, -1))}`}
            >
              <ChevronLeft aria-hidden="true" />
            </Link>
            <div>
              <span>Publication month</span>
              <strong>{monthLabel}</strong>
            </div>
            {nextDisabled ? (
              <span className={styles.disabledMonthControl} aria-hidden="true"><ChevronRight /></span>
            ) : (
              <Link
                href={archiveHref(query, { month: shiftMonth(query.month, 1) })}
                aria-label={`Show ${formatMonth(shiftMonth(query.month, 1))}`}
              >
                <ChevronRight aria-hidden="true" />
              </Link>
            )}
          </div>
        ) : null}
      </header>

      {!hasPublishedAnnouncements ? (
        <section className={styles.archivePanel} aria-labelledby="announcement-empty-title">
          <div className={styles.emptyState}>
            <Megaphone aria-hidden="true" />
            <h2 id="announcement-empty-title">No announcements yet.</h2>
            <p>Published notices will remain available here for review.</p>
            <Link href="/coach/announcements/new">Write the first announcement</Link>
          </div>
        </section>
      ) : (
        <section className={styles.archivePanel} aria-labelledby="announcement-archive-title">
          <div className={styles.archiveToolbar}>
            <div>
              <span>Notice board history</span>
              <h2 id="announcement-archive-title">{monthLabel}</h2>
            </div>
            <Link className={styles.newAnnouncementLink} href="/coach/announcements/new">
              New announcement
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </div>

          <form className={styles.archiveSearch} action="/coach/announcements" method="get" role="search">
            <input name="month" type="hidden" value={query.month} />
            <input name="status" type="hidden" value={query.status === "all" ? "" : query.status} />
            <input name="channel" type="hidden" value={query.channel === "all" ? "" : query.channel} />
            <label htmlFor="announcement-search">Find an announcement</label>
            <div>
              <Search aria-hidden="true" />
              <input
                autoComplete="off"
                defaultValue={query.query}
                id="announcement-search"
                maxLength={120}
                name="q"
                placeholder="Search title or message"
                type="search"
              />
              <button type="submit">Search</button>
            </div>
          </form>

          <details className={styles.archiveFilters} open={filtersActive || undefined}>
            <summary><Filter aria-hidden="true" /> Filters{filtersActive ? " · Active" : ""}</summary>
            <form action="/coach/announcements" method="get">
              <input name="month" type="hidden" value={query.month} />
              <input name="q" type="hidden" value={query.query} />
              <label>
                <span>Status</span>
                <select defaultValue={query.status} name="status">
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="withdrawn">Withdrawn</option>
                </select>
              </label>
              <label>
                <span>Location</span>
                <select defaultValue={query.channel} name="channel">
                  <option value="all">All locations</option>
                  <option value="homepage">Homepage</option>
                  <option value="player_dashboard">Player Dashboard</option>
                </select>
              </label>
              <button type="submit">Apply filters</button>
              {filtersActive ? <Link href={archiveHref(query, { channel: "all", status: "all" })}>Clear</Link> : null}
            </form>
          </details>

          {query.query || filtersActive ? (
            <div className={styles.resultBar} aria-live="polite">
              <p>{announcements.length} {announcements.length === 1 ? "result" : "results"}</p>
              {query.query ? <Link href={archiveHref(query, { query: "" })}>Clear search</Link> : null}
            </div>
          ) : null}

          {announcements.length === 0 ? (
            <div className={`${styles.emptyState} ${styles.compactEmptyState}`}>
              <Megaphone aria-hidden="true" />
              <h3>No matching announcements.</h3>
              <p>Try another month, search, or filter.</p>
              <Link href={archiveHref({ month: query.month, status: "all", channel: "all", query: "" })}>
                Clear search and filters
              </Link>
            </div>
          ) : (
            <ol className={styles.announcementList} aria-label={`${monthLabel} announcements`}>
              {announcements.map((announcement) => (
                <li key={announcement.id}>
                  <article className={styles.announcementRow}>
                    <div className={styles.announcementIdentity}>
                      <div>
                        {announcement.pinned ? <Pin aria-label="Pinned announcement" /> : null}
                        <h3>{announcement.title}</h3>
                      </div>
                      <p>{announcement.preview}</p>
                      <div className={styles.channelPills}>
                        {announcement.channels.map((channel) => (
                          <span key={channel}>{announcementChannelLabel(channel)}</span>
                        ))}
                      </div>
                    </div>

                    <dl className={styles.rowMeta}>
                      <div>
                        <dt>Status</dt>
                        <dd data-status={announcement.status}>{announcementStatusLabel(announcement.status)}</dd>
                      </div>
                      <div>
                        <dt>Published</dt>
                        <dd>
                          <time dateTime={announcement.publishedAt}>
                            {formatAcademyDate(announcement.publishedAt, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </time>
                        </dd>
                      </div>
                    </dl>

                    <Link className={styles.rowAction} href={detailHref(announcement.id, query)}>
                      Open
                      <ArrowUpRight aria-hidden="true" />
                    </Link>
                  </article>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  )
}
