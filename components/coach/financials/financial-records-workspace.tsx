import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Download, FileText, Search } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import { monthEnd } from "@/lib/finance/domain"
import { ACTIVITY_GROUPS, REGISTER_STATUS_FILTERS, activityGroupFor } from "@/lib/finance/records-filters"
import {
  formatAcademyTime,
  formatDateKey,
  formatInr,
  getAcademyDateKey,
} from "@/lib/format"
import {
  FINANCE_AUDIT_EVENTS,
  isFinanceAuditEventType,
  type FinanceActivityItem,
  type FinanceAuditEventType,
  type FinanceDayBookEvent,
  type FinanceDayBookSummary,
  type FinancePlayerScope,
  type FinanceRegisterMode,
  type FinanceRegisterRow,
  type FinanceRegisterSummary,
  type PaymentMethod,
} from "@/lib/finance/types"

import { FeeRegisterList, type FeeRegisterListRow } from "./fee-register-list"
import { FeesShell, type FeesTab } from "./fees-shell"
import { FilterForm } from "./filter-form"
import styles from "./fees.module.css"

export type FinancialRecordsView = FeesTab

export type FinancialRecordsPagination = {
  /** Said when there are later records but Next has reached its limit. */
  endNote?: string | null
  label: string
  nextHref?: string | null
  previousHref?: string | null
}

export type FeeRegisterView = {
  exportHref: string
  filters: {
    cursors: string
    mode: FinanceRegisterMode
    period: string
    query: string
    scope: FinancePlayerScope
    /** A status tile's key, one status from an older link, or "all". */
    status: string
  }
  pagination: FinancialRecordsPagination
  preparation?: ReactNode
  rows: FinanceRegisterRow[]
  summary: FinanceRegisterSummary
}

export type CollectionsDayBookEventView = FinanceDayBookEvent & {
  paymentId: string | null
}

export type CollectionsDayBookView = {
  /** The academy's current month, for the This month / Last month picks. */
  currentPeriod: string
  events: CollectionsDayBookEventView[]
  exportHref: string
  filters: {
    from: string
    includeReversed: boolean
    to: string
  }
  pagination: FinancialRecordsPagination
  summary: FinanceDayBookSummary
}

export type FinancialActivityView = {
  coachOptions: Array<{ id: string; name: string }>
  /** Events per type under the date and coach filters; null while a search is typed. */
  counts: Partial<Record<FinanceAuditEventType, number>> | null
  filters: {
    coachId: string
    eventType: string
    from: string
    query: string
    to: string
  }
  exportHref?: string | null
  items: FinanceActivityItem[]
  pagination: FinancialRecordsPagination
}

export type FinancialRecordsWorkspaceProps =
  | {
    activeView: "fees"
    activity?: never
    dayBook?: never
    feeRegister: FeeRegisterView
  }
  | {
    activeView: "collections"
    activity?: never
    dayBook: CollectionsDayBookView
    feeRegister?: never
  }
  | {
    activeView: "activity"
    activity: FinancialActivityView
    dayBook?: never
    feeRegister?: never
  }

function recordsHref(
  view: FinancialRecordsView,
  params: Record<string, string | undefined> = {},
) {
  const search = new URLSearchParams({ view })
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  return `/coach/financials/records?${search.toString()}`
}

export function formatFinancialPaymentMethod(method: PaymentMethod) {
  if (method === "upi") return "UPI"
  return method.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase())
}

const periodFormat = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  timeZone: "UTC",
  year: "numeric",
})

function formatPeriod(period: string) {
  const [year, month] = period.split("-").map(Number)
  if (!year || !month) return period
  return periodFormat.format(new Date(Date.UTC(year, month - 1, 1)))
}

function shiftPeriod(period: string, months: number) {
  const [year, month] = period.split("-").map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`
}

function dayHeading(dateKey: string) {
  return formatDateKey(dateKey, { day: "numeric", month: "short", weekday: "short", year: "numeric" })
}

function Pagination({ pagination }: { pagination: FinancialRecordsPagination }) {
  return (
    <nav className={styles.pager} aria-label="Record pages">
      <span>
        {pagination.label}
        {pagination.endNote ? <small>{pagination.endNote}</small> : null}
      </span>
      <div>
        {pagination.previousHref ? (
          <Link className={styles.button} href={pagination.previousHref}><ArrowLeft aria-hidden="true" /> Previous</Link>
        ) : null}
        {pagination.nextHref ? (
          <Link className={styles.button} href={pagination.nextHref}>Next <ArrowRight aria-hidden="true" /></Link>
        ) : null}
      </div>
    </nav>
  )
}

function FeeRegister({ register }: { register: FeeRegisterView }) {
  const { filters, summary } = register
  const isRegistration = filters.mode === "registration"
  const keep = {
    mode: filters.mode,
    period: isRegistration ? undefined : filters.period,
    q: filters.query || undefined,
    scope: filters.scope === "active" ? undefined : filters.scope,
  }
  const statusParam = filters.status === "all" ? undefined : filters.status
  const recordSearch = (playerId: string) => {
    const search = new URLSearchParams({
      mode: filters.mode,
      period: filters.period,
      scope: filters.scope,
      status: filters.status,
    })
    if (filters.query) search.set("q", filters.query)
    if (filters.cursors) search.set("cursors", filters.cursors)
    return `/coach/financials/players/${encodeURIComponent(playerId)}?${search.toString()}`
  }
  const rows: FeeRegisterListRow[] = register.rows.map((row) => ({
    ...row,
    paymentHref: row.outstandingPaise > 0 && !row.archived
      ? `/coach/financials/record?${new URLSearchParams({ player: row.playerId, query: row.academyId }).toString()}`
      : null,
    recordHref: recordSearch(row.playerId),
  }))
  const allCount = Object.values(summary.statusCounts).reduce((total, count) => total + (count ?? 0), 0)
  const tiles = [
    { count: allCount, key: "all", label: "All" },
    ...REGISTER_STATUS_FILTERS.map((filter) => ({
      count: filter.statuses.reduce((total, status) => total + (summary.statusCounts[status] ?? 0), 0),
      key: filter.key,
      label: filter.label,
    })),
  ].filter((tile) => tile.key !== "void" || tile.count > 0 || filters.status === "void")
  const startNumber = Number.parseInt(register.pagination.label.match(/^\d+/u)?.[0] ?? "1", 10)

  return (
    <section aria-label={isRegistration ? "Registration fees" : `${formatPeriod(filters.period)} monthly fees`}>
      <FilterForm action="/coach/financials/records" className={styles.bar} label="Filter fees">
        <input type="hidden" name="view" value="fees" />
        <input type="hidden" name="mode" value={filters.mode} />
        {statusParam ? <input type="hidden" name="status" value={statusParam} /> : null}
        {isRegistration ? null : (
          <span className={styles.month}>
            <Link
              aria-label={`Show ${formatPeriod(shiftPeriod(filters.period, -1))}`}
              href={recordsHref("fees", { ...keep, period: shiftPeriod(filters.period, -1), status: statusParam })}
            >
              <ChevronLeft aria-hidden="true" />
            </Link>
            <input aria-label="Fee month" className={styles.field} defaultValue={filters.period} name="period" type="month" />
            <Link
              aria-label={`Show ${formatPeriod(shiftPeriod(filters.period, 1))}`}
              href={recordsHref("fees", { ...keep, period: shiftPeriod(filters.period, 1), status: statusParam })}
            >
              <ChevronRight aria-hidden="true" />
            </Link>
          </span>
        )}
        <span className={styles.seg} role="group" aria-label="Choose fee register">
          <Link aria-current={isRegistration ? undefined : "page"} href={recordsHref("fees", { ...keep, mode: "monthly", period: filters.period })}>Monthly</Link>
          <Link aria-current={isRegistration ? "page" : undefined} href={recordsHref("fees", { ...keep, mode: "registration", period: undefined })}>Registration</Link>
        </span>
        <label className={styles.search}>
          <Search aria-hidden="true" />
          <span className="sr-only">Find a record</span>
          <input defaultValue={filters.query} maxLength={120} name="q" placeholder="Player, Academy ID or fee reference" type="search" />
        </label>
        <select aria-label="Players" className={styles.field} defaultValue={filters.scope} name="scope">
          <option value="active">Active players</option>
          <option value="archived">Archived players</option>
          <option value="all">All players</option>
        </select>
        <a className={`${styles.plainLink} ${styles.end}`} href={register.exportHref}>
          <Download aria-hidden="true" /> Export CSV
        </a>
      </FilterForm>

      <p className={styles.totals}>
        <span>{isRegistration ? "Charged" : "Billed"}<b>{formatInr(summary.effectiveAmountPaise)}</b></span>
        <span>Received<b>{formatInr(summary.receivedPaise)}</b></span>
        <span className={summary.outstandingPaise > 0 ? styles.owed : undefined}>Outstanding<b>{formatInr(summary.outstandingPaise)}</b></span>
      </p>

      {!isRegistration && register.preparation ? register.preparation : null}

      <nav className={styles.tiles} aria-label="Filter by status">
        {tiles.map((tile) => (
          <Link
            key={tile.key}
            aria-current={(filters.status === tile.key) ? "page" : undefined}
            data-zero={tile.count === 0 ? "" : undefined}
            href={recordsHref("fees", { ...keep, status: tile.key === "all" ? undefined : tile.key })}
          >
            <b>{tile.count}</b>
            <span>{tile.label}</span>
          </Link>
        ))}
      </nav>

      {rows.length ? (
        <FeeRegisterList rows={rows} startNumber={startNumber} />
      ) : (
        <div className={styles.empty} role="status">
          No matching fee records
          <p>
            {isRegistration
              ? "Change the filters to review another part of the registration fee record."
              : "Change the month or filters to review another part of the fee record."}
          </p>
        </div>
      )}

      <Pagination pagination={register.pagination} />
    </section>
  )
}

const paymentMethodOrder: PaymentMethod[] = ["upi", "cash", "card", "bank_transfer", "cheque", "other"]
const methodSwatch: Record<PaymentMethod, string> = {
  bank_transfer: "var(--steel)",
  card: "var(--makeup-dark)",
  cash: "var(--green)",
  cheque: "var(--steel-dark)",
  other: "var(--line-control)",
  upi: "var(--navy)",
}

function CollectionsFigures({ summary }: { summary: FinanceDayBookSummary }) {
  const methods = paymentMethodOrder
    .map((method) => ({ amountPaise: summary.byMethod[method], method }))
    .filter((item) => item.amountPaise !== 0)
  const barTotal = methods.reduce((total, item) => total + Math.max(item.amountPaise, 0), 0)

  return (
    <dl className={styles.figures}>
      <div><dt>Received</dt><dd>{formatInr(summary.grossReceivedPaise)}</dd></div>
      <div className={summary.refundsPaise > 0 ? styles.refundFigure : undefined}><dt>Refunds</dt><dd>{formatInr(summary.refundsPaise)}</dd></div>
      <div><dt>Net</dt><dd>{formatInr(summary.netCollectionsPaise)}</dd></div>
      <div className={styles.methodCell}>
        <dt>By method</dt>
        <dd>
          {methods.length ? (
            <>
              {barTotal > 0 ? (
                <span className={styles.methodBar} aria-hidden="true">
                  {methods.filter((item) => item.amountPaise > 0).map((item) => (
                    <i key={item.method} style={{ width: `${(item.amountPaise / barTotal) * 100}%`, background: methodSwatch[item.method] }} />
                  ))}
                </span>
              ) : null}
              <dl className={styles.methodList} aria-label="Collections by payment method">
                {methods.map((item) => (
                  <div key={item.method} style={{ ["--swatch" as string]: methodSwatch[item.method] }}>
                    <dt>{formatFinancialPaymentMethod(item.method)}</dt>
                    <dd>{formatInr(item.amountPaise)}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : "No payments in this period."}
        </dd>
      </div>
    </dl>
  )
}

function groupByDay<T>(items: T[], dateKeyOf: (item: T) => string) {
  const days: Array<{ dateKey: string; items: T[] }> = []
  for (const item of items) {
    const dateKey = dateKeyOf(item)
    const last = days.at(-1)
    if (last?.dateKey === dateKey) last.items.push(item)
    else days.push({ dateKey, items: [item] })
  }
  return days
}

function CollectionsDayBook({ dayBook }: { dayBook: CollectionsDayBookView }) {
  const thisMonth = { from: `${dayBook.currentPeriod}-01`, to: monthEnd(dayBook.currentPeriod) }
  const lastPeriod = shiftPeriod(dayBook.currentPeriod, -1)
  const lastMonth = { from: `${lastPeriod}-01`, to: monthEnd(lastPeriod) }
  const reversed = dayBook.filters.includeReversed ? "true" : undefined
  const isRange = (range: { from: string; to: string }) => (
    dayBook.filters.from === range.from && dayBook.filters.to === range.to
  )
  const days = groupByDay(dayBook.events, (event) => event.eventDate)

  return (
    <section className={styles.panel} aria-label="Collections">
      <FilterForm action="/coach/financials/records" className={`${styles.bar} ${styles.panelBar}`} label="Filter collections">
        <input type="hidden" name="view" value="collections" />
        <span className={styles.seg} role="group" aria-label="Choose dates">
          <Link aria-current={isRange(thisMonth) ? "page" : undefined} href={recordsHref("collections", { ...thisMonth, includeReversed: reversed })}>This month</Link>
          <Link aria-current={isRange(lastMonth) ? "page" : undefined} href={recordsHref("collections", { ...lastMonth, includeReversed: reversed })}>Last month</Link>
        </span>
        <input aria-label="From" className={styles.field} defaultValue={dayBook.filters.from} name="from" type="date" />
        <input aria-label="To" className={styles.field} defaultValue={dayBook.filters.to} name="to" type="date" />
        <label className={styles.toggle}>
          <input defaultChecked={dayBook.filters.includeReversed} name="includeReversed" type="checkbox" value="true" />
          Show reversed
        </label>
        <a className={`${styles.plainLink} ${styles.end}`} href={dayBook.exportHref}>
          <Download aria-hidden="true" /> Export CSV
        </a>
      </FilterForm>

      <CollectionsFigures summary={dayBook.summary} />

      <table className={styles.table}>
        <caption className="sr-only">Payment and refund records</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Player · receipt</th>
            <th scope="col">Paid toward</th>
            <th scope="col">Method</th>
            <th scope="col" className={styles.num}>Amount</th>
            <th scope="col"><span className="sr-only">Receipt</span></th>
          </tr>
        </thead>
        <tbody>
          {days.length ? days.map((day) => {
            const payments = day.items.filter((event) => event.eventType === "payment")
            const refunds = day.items.length - payments.length
            const net = day.items.reduce((total, event) => (
              total + (event.eventType === "refund" ? -event.amountPaise : event.amountPaise)
            ), 0)
            return [
              <tr key={day.dateKey} className={styles.day}>
                <th scope="colgroup" colSpan={6}>
                  {dayHeading(day.dateKey)}
                  <span>
                    {[
                      payments.length ? `${payments.length} ${payments.length === 1 ? "payment" : "payments"}` : null,
                      refunds ? `${refunds} ${refunds === 1 ? "refund" : "refunds"}` : null,
                    ].filter(Boolean).join(" · ")} · {net < 0 ? "−" : ""}{formatInr(Math.abs(net))}
                  </span>
                </th>
              </tr>,
              ...day.items.map((event) => (
                <tr key={event.id}>
                  <td data-hide-phone="">{formatAcademyTime(event.recordedAt)}</td>
                  <td>
                    <strong>{event.playerFullName}</strong>
                    <small>{event.reference} · {event.academyId}</small>
                  </td>
                  <td data-wide=""><small>{event.eventType === "refund" ? "Refund · " : ""}{event.coveredFeeReferences.join(" · ")}</small></td>
                  <td data-wide="">
                    <span className={styles.tag}>{formatFinancialPaymentMethod(event.method)}</span>{" "}
                    {event.lifecycle === "reversed" ? <span className={styles.tag} data-tone="red">Reversed</span> : null}
                  </td>
                  <td className={`${styles.num} ${event.eventType === "refund" ? styles.refund : ""}`}>
                    <strong>{event.eventType === "refund" ? "−" : ""}{formatInr(event.amountPaise)}</strong>
                  </td>
                  <td data-wide="">
                    {event.eventType === "payment" && event.paymentId ? (
                      <a
                        aria-label={`Download receipt ${event.reference} for ${event.playerFullName}`}
                        className={styles.rowLink}
                        href={`/coach/financials/receipts/${event.paymentId}/download`}
                      >
                        <FileText aria-hidden="true" /> Receipt
                      </a>
                    ) : null}
                  </td>
                </tr>
              )),
            ]
          }) : (
            <tr className={styles.emptyRow}>
              <td colSpan={6} role="status">
                No collections in this period. Try another date range or show reversed records.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <Pagination pagination={dayBook.pagination} />
    </section>
  )
}

function ActivityHistory({ activity }: { activity: FinancialActivityView }) {
  const keep = {
    coachId: activity.filters.coachId === "all" ? undefined : activity.filters.coachId,
    from: activity.filters.from || undefined,
    q: activity.filters.query || undefined,
    to: activity.filters.to || undefined,
  }
  const total = activity.counts
    ? Object.values(activity.counts).reduce((sum, count) => sum + (count ?? 0), 0)
    : null
  const chips = [
    { count: total, key: "all", label: "All" },
    ...ACTIVITY_GROUPS.map((group) => ({
      count: activity.counts
        ? group.eventTypes.reduce((sum, type) => sum + (activity.counts?.[type] ?? 0), 0)
        : null,
      key: group.key,
      label: group.label,
    })),
    // One event type from an older link still filters; its chip names it.
    ...isFinanceAuditEventType(activity.filters.eventType) ? [{
      count: activity.counts?.[activity.filters.eventType] ?? null,
      key: activity.filters.eventType,
      label: FINANCE_AUDIT_EVENTS[activity.filters.eventType].filterLabel,
    }] : [],
  ]
  const days = groupByDay(activity.items, (item) => getAcademyDateKey(new Date(item.occurredAt)))

  return (
    <section className={styles.panel} aria-label="Activity">
      <FilterForm action="/coach/financials/records" className={`${styles.bar} ${styles.panelBar}`} label="Filter activity">
        <input type="hidden" name="view" value="activity" />
        {activity.filters.eventType !== "all" ? <input type="hidden" name="eventType" value={activity.filters.eventType} /> : null}
        <label className={styles.search}>
          <Search aria-hidden="true" />
          <span className="sr-only">Find activity</span>
          <input defaultValue={activity.filters.query} maxLength={120} name="q" placeholder="Player or financial reference" type="search" />
        </label>
        <select aria-label="Coach" className={styles.field} defaultValue={activity.filters.coachId} name="coachId">
          <option value="all">All coaches</option>
          {activity.coachOptions.map((coach) => <option key={coach.id} value={coach.id}>{coach.name}</option>)}
        </select>
        <input aria-label="From" className={styles.field} defaultValue={activity.filters.from} name="from" type="date" />
        <input aria-label="To" className={styles.field} defaultValue={activity.filters.to} name="to" type="date" />
        {activity.exportHref ? (
          <a className={`${styles.plainLink} ${styles.end}`} href={activity.exportHref}>
            <Download aria-hidden="true" /> Export CSV
          </a>
        ) : null}
      </FilterForm>

      <nav className={styles.chips} aria-label="Filter by kind">
        {chips.map((chip) => (
          <Link
            key={chip.key}
            aria-current={activity.filters.eventType === chip.key ? "page" : undefined}
            href={recordsHref("activity", { ...keep, eventType: chip.key === "all" ? undefined : chip.key })}
          >
            {chip.label}{chip.count === null ? null : <b>{chip.count}</b>}
          </Link>
        ))}
      </nav>

      <table className={styles.table}>
        <caption className="sr-only">Changes to academy finances</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">What happened</th>
            <th scope="col">Player · reference</th>
            <th scope="col">By</th>
            <th scope="col" className={styles.num}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {days.length ? days.map((day) => [
            <tr key={day.dateKey} className={styles.day}>
              <th scope="colgroup" colSpan={5}>
                {dayHeading(day.dateKey)}
                <span>{day.items.length} {day.items.length === 1 ? "change" : "changes"}</span>
              </th>
            </tr>,
            ...day.items.map((item) => (
              <tr key={item.id}>
                <td data-hide-phone=""><time dateTime={item.occurredAt}>{formatAcademyTime(item.occurredAt)}</time></td>
                <td data-wide=""><span className={styles.tag} data-group={activityGroupFor(item.eventType)?.key}>{item.action}</span></td>
                <td>
                  <strong>{[item.playerName, item.academyId].filter(Boolean).join(" · ") || "Academy"}</strong>
                  {item.reference ? <small>{item.reference}</small> : null}
                  {item.reason ? <q>{item.reason}</q> : null}
                </td>
                <td data-wide=""><small>{item.actorName}</small></td>
                <td className={styles.num}>
                  <strong>{item.amountPaise === null ? "—" : formatInr(item.amountPaise)}</strong>
                </td>
              </tr>
            )),
          ]) : (
            <tr className={styles.emptyRow}>
              <td colSpan={5} role="status">
                No matching activity. Change the search or dates to review another part of the history.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <Pagination pagination={activity.pagination} />
    </section>
  )
}

export function FinancialRecordsWorkspace(props: FinancialRecordsWorkspaceProps) {
  return (
    <FeesShell activeTab={props.activeView}>
      {props.activeView === "fees" ? <FeeRegister register={props.feeRegister} /> : null}
      {props.activeView === "collections" ? <CollectionsDayBook dayBook={props.dayBook} /> : null}
      {props.activeView === "activity" ? <ActivityHistory activity={props.activity} /> : null}
    </FeesShell>
  )
}
