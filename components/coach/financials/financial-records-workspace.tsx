import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileClock,
  FileText,
  History,
  ReceiptIndianRupee,
  Search,
  WalletCards,
} from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import { formatAcademyDate, formatAcademyTime, formatDateKey } from "@/lib/format"
import type {
  FinanceActivityItem,
  FinanceDayBookEvent,
  FinanceDayBookSummary,
  FinancePlayerScope,
  FinanceRegisterMode,
  FinanceRegisterRow,
  FinanceRegisterSummary,
  FinanceStatus,
  PaymentMethod,
} from "@/lib/finance/types"

import recordsStyles from "./financial-records.module.css"
import financialStyles from "./financials.module.css"

export type FinancialRecordsView = "fees" | "collections" | "activity"

export type FinancialRecordsPagination = {
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
    status: FinanceStatus | "all"
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
  eventTypeOptions: Array<{ label: string; value: string }>
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

const statusLabels: Record<FinanceStatus, string> = {
  not_prepared: "Not issued",
  overdue: "Overdue",
  paid: "Paid",
  partially_paid: "Partially paid",
  pending: "Pending",
  setup_required: "Setup required",
  void: "Void",
}

const recordViews: Array<{
  icon: typeof WalletCards
  label: string
  value: FinancialRecordsView
}> = [
  { icon: WalletCards, label: "Fee register", value: "fees" },
  { icon: ReceiptIndianRupee, label: "Collections", value: "collections" },
  { icon: History, label: "Activity", value: "activity" },
]

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

export function formatFinancialRecordsAmount(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    currency: "INR",
    maximumFractionDigits: paise % 100 ? 2 : 0,
    style: "currency",
  }).format(paise / 100)
}

export function formatFinancialPaymentMethod(method: PaymentMethod) {
  if (method === "upi") return "UPI"
  return method.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase())
}

export function formatFinancialActivityTime(value: string) {
  return `${formatAcademyDate(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })} · ${formatAcademyTime(value)}`
}

function formatPeriod(period: string) {
  const [year, month] = period.split("-").map(Number)
  if (!year || !month) return period
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function statusClass(status: FinanceStatus) {
  if (status === "paid") return recordsStyles.statusPositive
  if (status === "overdue" || status === "setup_required") return recordsStyles.statusAttention
  if (status === "partially_paid" || status === "pending") return recordsStyles.statusPending
  return recordsStyles.statusQuiet
}

function StatusLabel({ status }: { status: FinanceStatus }) {
  return <span className={`${recordsStyles.status} ${statusClass(status)}`}>{statusLabels[status]}</span>
}

function Pagination({ pagination }: { pagination: FinancialRecordsPagination }) {
  return (
    <nav className={recordsStyles.pagination} aria-label="Record pages">
      <span>{pagination.label}</span>
      <div>
        {pagination.previousHref ? (
          <Link href={pagination.previousHref}><ArrowLeft aria-hidden="true" /> Previous</Link>
        ) : (
          <span aria-disabled="true"><ArrowLeft aria-hidden="true" /> Previous</span>
        )}
        {pagination.nextHref ? (
          <Link href={pagination.nextHref}>Next <ArrowRight aria-hidden="true" /></Link>
        ) : (
          <span aria-disabled="true">Next <ArrowRight aria-hidden="true" /></span>
        )}
      </div>
    </nav>
  )
}

function EmptyRecords({
  body,
  icon: Icon,
  title,
}: {
  body: string
  icon: typeof WalletCards
  title: string
}) {
  return (
    <div className={recordsStyles.emptyState} role="status">
      <Icon aria-hidden="true" />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  )
}

function RecordsNavigation({ activeView }: { activeView: FinancialRecordsView }) {
  return (
    <nav className={recordsStyles.viewNavigation} aria-label="Fee record views">
      {recordViews.map(({ icon: Icon, label, value }) => (
        <Link
          key={value}
          className={activeView === value ? recordsStyles.activeView : undefined}
          href={recordsHref(value)}
          aria-current={activeView === value ? "page" : undefined}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  )
}

function RegisterModeSwitch({
  filterParams,
  mode,
}: {
  filterParams: Record<string, string>
  mode: FinanceRegisterMode
}) {
  return (
    <div className={recordsStyles.modeSwitch} aria-label="Choose fee register" role="group">
      <Link
        className={mode === "monthly" ? recordsStyles.activeMode : undefined}
        href={recordsHref("fees", { ...filterParams, mode: "monthly" })}
        aria-current={mode === "monthly" ? "page" : undefined}
      >
        Monthly fees
      </Link>
      <Link
        className={mode === "registration" ? recordsStyles.activeMode : undefined}
        href={recordsHref("fees", { ...filterParams, mode: "registration" })}
        aria-current={mode === "registration" ? "page" : undefined}
      >
        Registration fees
      </Link>
    </div>
  )
}

function FeeTruthRail({
  mode,
  period,
  summary,
}: {
  mode: FinanceRegisterMode
  period: string
  summary: FeeRegisterView["summary"]
}) {
  const isRegistration = mode === "registration"
  const effective = formatFinancialRecordsAmount(summary.effectiveAmountPaise)
  const received = formatFinancialRecordsAmount(summary.receivedPaise)
  const outstanding = formatFinancialRecordsAmount(summary.outstandingPaise)
  const feeLabel = isRegistration ? "Net registration fees" : "Net monthly fees"

  return (
    <div className={recordsStyles.registrationTruthRail}>
      <div className={recordsStyles.registrationRecordCount}>
        <span>{isRegistration ? "One-time academy entry" : `${formatPeriod(period)} fee cycle`}</span>
        <strong>{summary.totalRows} {summary.totalRows === 1 ? "record" : "records"}</strong>
      </div>
      <p className="sr-only">
        {feeLabel} {effective}, minus received {received}, equals outstanding {outstanding}.
      </p>
      <div className={recordsStyles.registrationEquation} aria-hidden="true">
        <div><span>{feeLabel}</span><strong>{effective}</strong></div>
        <b>−</b>
        <div className={summary.receivedPaise > 0 ? recordsStyles.figureReceived : undefined}>
          <span>Received</span><strong>{received}</strong>
        </div>
        <b>=</b>
        <div className={summary.outstandingPaise > 0 ? recordsStyles.figureOwed : undefined}>
          <span>Outstanding</span><strong>{outstanding}</strong>
        </div>
      </div>
    </div>
  )
}

function FeeRegisterTable({
  mode,
  playerRecordHref,
  register,
}: {
  mode: FinanceRegisterMode
  playerRecordHref: (playerId: string) => string
  register: FeeRegisterView
}) {
  const isRegistration = mode === "registration"
  const visibleStart = Number.parseInt(register.pagination.label.match(/^\d+/u)?.[0] ?? "1", 10)

  return (
    <div className={`${recordsStyles.tableWrap} ${recordsStyles.registrationTableWrap}`}>
      <table className={`${recordsStyles.recordsTable} ${recordsStyles.registrationTable}`}>
        <caption className="sr-only">
          {isRegistration ? "One-time academy registration fee records" : `${formatPeriod(register.filters.period)} monthly fee records`}
        </caption>
        <thead>
          <tr>
            <th scope="col">No.</th>
            <th scope="col">Player</th>
            <th scope="col">{isRegistration ? "Registration entry" : "Monthly fee"}</th>
            <th scope="col">Amounts</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {register.rows.map((row, index) => {
            const adjustments = [
              row.creditAdjustmentsPaise
                ? `${formatFinancialRecordsAmount(row.creditAdjustmentsPaise)} credit`
                : null,
              row.debitAdjustmentsPaise
                ? `${formatFinancialRecordsAmount(row.debitAdjustmentsPaise)} debit`
                : null,
            ].filter(Boolean).join(" · ")
            const dueLabel = row.dueDate
              ? `Due ${formatDateKey(row.dueDate, { day: "numeric", month: "short", year: "numeric" })}`
              : "No charge issued"

            return (
              <tr key={`${row.playerId}-${row.feeReference ?? "not-prepared"}`}>
                <td className={recordsStyles.registrationFolio} data-label="Record number">
                  {String(visibleStart + index).padStart(2, "0")}
                </td>
                <td className={recordsStyles.registrationPlayer} data-label="Player">
                  <strong>{row.fullName}</strong>
                  <small>{row.academyId}{row.archived ? " · Archived" : ""}</small>
                </td>
                <td className={recordsStyles.registrationEntry} data-label={isRegistration ? "Registration entry" : "Monthly fee"}>
                  <strong>{row.feeReference ?? "Not issued"}</strong>
                  <small>{dueLabel}{adjustments ? ` · ${adjustments}` : " · No adjustments"}</small>
                </td>
                <td className={recordsStyles.registrationAmounts} data-label="Amounts">
                  <dl>
                    <div><dt>{isRegistration ? "Charged" : "Billed"}</dt><dd>{formatFinancialRecordsAmount(row.originalAmountPaise)}</dd></div>
                    <div><dt>Received</dt><dd>{formatFinancialRecordsAmount(row.receivedPaise)}</dd></div>
                    <div><dt>Balance</dt><dd>{formatFinancialRecordsAmount(row.outstandingPaise)}</dd></div>
                  </dl>
                </td>
                <td className={recordsStyles.registrationStatus} data-label="Status">
                  <StatusLabel status={row.status} />
                </td>
                <td className={recordsStyles.registrationAction} data-label="Record">
                  <Link
                    aria-label={`View fee record for ${row.fullName}`}
                    className={recordsStyles.rowAction}
                    href={playerRecordHref(row.playerId)}
                  >
                    <FileText aria-hidden="true" /> Open record
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FeeRegister({ register }: { register: FeeRegisterView }) {
  const isRegistration = register.filters.mode === "registration"
  const filterParams = {
    period: register.filters.period,
    q: register.filters.query,
    scope: register.filters.scope,
    status: register.filters.status,
  }
  const playerRecordHref = (playerId: string) => {
    const search = new URLSearchParams({
      mode: register.filters.mode,
      period: register.filters.period,
      scope: register.filters.scope,
      status: register.filters.status,
    })
    if (register.filters.query) search.set("q", register.filters.query)
    if (register.filters.cursors) search.set("cursors", register.filters.cursors)
    return `/coach/financials/players/${encodeURIComponent(playerId)}?${search.toString()}`
  }

  return (
    <section
      className={`${recordsStyles.panel} ${recordsStyles.registrationPanel}`}
      aria-labelledby="fee-register-title"
    >
      <header className={`${recordsStyles.panelHeader} ${recordsStyles.registrationPanelHeader}`}>
        <div>
          <span>Player fees</span>
          <h2 id="fee-register-title">{isRegistration ? "Registration fees" : "Monthly fees"}</h2>
          <p>
            {!isRegistration
              ? `${formatPeriod(register.filters.period)} player fee cycle.`
              : "One-time academy registration fee records."}
          </p>
        </div>
        <div className={recordsStyles.registrationHeaderActions}>
          <RegisterModeSwitch filterParams={filterParams} mode={register.filters.mode} />
          <a className={recordsStyles.downloadLink} href={register.exportHref}>
            <Download aria-hidden="true" /> Export CSV
          </a>
        </div>
      </header>

      <FeeTruthRail
        mode={register.filters.mode}
        period={register.filters.period}
        summary={register.summary}
      />

      {register.filters.mode === "monthly" && register.preparation ? (
        <div className={recordsStyles.preparationEmbed}>
          {register.preparation}
        </div>
      ) : null}

      <form
        className={`${recordsStyles.filters} ${recordsStyles.registrationFilters} ${!isRegistration ? recordsStyles.monthlyFilters : ""}`}
        action="/coach/financials/records"
        method="get"
        role="search"
      >
        <input type="hidden" name="view" value="fees" />
        <input type="hidden" name="mode" value={register.filters.mode} />
        <label className={recordsStyles.searchField}>
          <span>Find a record</span>
          <span className={recordsStyles.searchInput}>
            <Search aria-hidden="true" />
            <input
              defaultValue={register.filters.query}
              maxLength={120}
              name="q"
              placeholder="Player, Academy ID or fee reference"
              type="search"
            />
          </span>
        </label>
        {register.filters.mode === "monthly" ? (
          <label>
            <span>Fee month</span>
            <input defaultValue={register.filters.period} name="period" type="month" />
          </label>
        ) : null}
        <label>
          <span>Status</span>
          <select defaultValue={register.filters.status} name="status">
            <option value="all">All statuses</option>
            <option value="overdue">Overdue</option>
            <option value="partially_paid">Partially paid</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="not_prepared">Not issued</option>
            <option value="void">Void</option>
          </select>
        </label>
        <label>
          <span>Players</span>
          <select defaultValue={register.filters.scope} name="scope">
            <option value="active">Active players</option>
            <option value="archived">Archived players</option>
            <option value="all">All players</option>
          </select>
        </label>
        <button type="submit">Apply filters</button>
      </form>

      {register.rows.length ? (
        <FeeRegisterTable
          mode={register.filters.mode}
          playerRecordHref={playerRecordHref}
          register={register}
        />
      ) : (
        <EmptyRecords
          body={isRegistration
            ? "Change the filters to review another part of the registration fee record."
            : "Change the month or filters to review another part of the fee record."}
          icon={WalletCards}
          title="No matching fee records"
        />
      )}

      <Pagination pagination={register.pagination} />
    </section>
  )
}

const paymentMethodOrder: PaymentMethod[] = ["upi", "cash", "bank_transfer", "card", "cheque", "other"]

function CollectionsSummary({ summary }: { summary: CollectionsDayBookView["summary"] }) {
  const methodTotals = paymentMethodOrder
    .map((method) => ({ amountPaise: summary.byMethod[method], method }))
    .filter((item) => item.amountPaise !== 0)

  return (
    <>
      <dl className={recordsStyles.summaryGrid}>
        <div><dt>Gross received</dt><dd>{formatFinancialRecordsAmount(summary.grossReceivedPaise)}</dd></div>
        <div><dt>Refunds</dt><dd>{formatFinancialRecordsAmount(summary.refundsPaise)}</dd></div>
        <div className={recordsStyles.summaryWide}><dt>Net collections</dt><dd>{formatFinancialRecordsAmount(summary.netCollectionsPaise)}</dd></div>
      </dl>
      {methodTotals.length ? (
        <dl className={recordsStyles.methodSummary} aria-label="Collections by payment method">
          {methodTotals.map((item) => (
            <div key={item.method}>
              <dt>{formatFinancialPaymentMethod(item.method)}</dt>
              <dd>{formatFinancialRecordsAmount(item.amountPaise)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  )
}

function CollectionsDayBook({ dayBook }: { dayBook: CollectionsDayBookView }) {
  return (
    <section className={recordsStyles.panel} aria-labelledby="collections-day-book-title">
      <header className={recordsStyles.panelHeader}>
        <div>
          <span>Money movement</span>
          <h2 id="collections-day-book-title">Collections Day Book</h2>
          <p>Payments and refunds recorded during the selected period.</p>
        </div>
        <a className={recordsStyles.downloadLink} href={dayBook.exportHref}>
          <Download aria-hidden="true" /> Export CSV
        </a>
      </header>

      <form className={`${recordsStyles.filters} ${recordsStyles.dayBookFilters}`} action="/coach/financials/records" method="get">
        <input type="hidden" name="view" value="collections" />
        <label><span>From</span><input defaultValue={dayBook.filters.from} name="from" type="date" /></label>
        <label><span>To</span><input defaultValue={dayBook.filters.to} name="to" type="date" /></label>
        <label className={recordsStyles.checkboxField}>
          <input defaultChecked={dayBook.filters.includeReversed} name="includeReversed" type="checkbox" value="true" />
          <span>Include reversed records</span>
        </label>
        <button type="submit">Apply dates</button>
      </form>

      <CollectionsSummary summary={dayBook.summary} />

      {dayBook.events.length ? (
        <div className={recordsStyles.tableWrap}>
          <table className={recordsStyles.recordsTable}>
            <caption className="sr-only">Payment and refund records</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Reference</th>
                <th scope="col">Player</th>
                <th scope="col">Method</th>
                <th scope="col">Fees</th>
                <th scope="col">Amount</th>
                <th scope="col">State</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {dayBook.events.map((event) => (
                <tr key={event.id}>
                  <td data-label="Date">{formatDateKey(event.eventDate, { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td data-label="Reference">
                    <strong>{event.reference}</strong>
                    <small>{event.eventType === "payment" ? "Payment" : "Refund"}</small>
                  </td>
                  <td data-label="Player"><strong>{event.playerFullName}</strong><small>{event.academyId}</small></td>
                  <td data-label="Method">{formatFinancialPaymentMethod(event.method)}</td>
                  <td data-label="Fees" className={recordsStyles.feeReferences}>{event.coveredFeeReferences.join(" · ")}</td>
                  <td data-label="Amount"><strong className={event.eventType === "refund" ? recordsStyles.refundAmount : undefined}>{event.eventType === "refund" ? "−" : ""}{formatFinancialRecordsAmount(event.amountPaise)}</strong></td>
                  <td data-label="State">
                    <span className={`${recordsStyles.status} ${event.lifecycle === "reversed" ? recordsStyles.statusAttention : recordsStyles.statusPositive}`}>
                      {event.lifecycle === "reversed" ? "Reversed" : "Recorded"}
                    </span>
                  </td>
                  <td data-label="Record">
                    {event.eventType === "payment" && event.paymentId ? (
                      <a
                        aria-label={`Download receipt ${event.reference} for ${event.playerFullName}`}
                        className={recordsStyles.rowAction}
                        href={`/coach/financials/receipts/${event.paymentId}/download`}
                      >
                        <FileText aria-hidden="true" /> Receipt
                      </a>
                    ) : <span className={recordsStyles.noAction}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyRecords
          body="Try another date range or include reversed records."
          icon={ReceiptIndianRupee}
          title="No collections in this period"
        />
      )}

      <Pagination pagination={dayBook.pagination} />
    </section>
  )
}

function ActivityHistory({ activity }: { activity: FinancialActivityView }) {
  return (
    <section className={recordsStyles.panel} aria-labelledby="financial-activity-title">
      <header className={recordsStyles.panelHeader}>
        <div>
          <span>Audit history</span>
          <h2 id="financial-activity-title">Activity History</h2>
          <p>A readable record of changes made to academy finances.</p>
        </div>
        {activity.exportHref ? (
          <a className={recordsStyles.downloadLink} href={activity.exportHref}>
            <Download aria-hidden="true" /> Export CSV
          </a>
        ) : null}
      </header>

      <form className={`${recordsStyles.filters} ${recordsStyles.activityFilters}`} action="/coach/financials/records" method="get" role="search">
        <input type="hidden" name="view" value="activity" />
        <label className={recordsStyles.searchField}>
          <span>Find activity</span>
          <span className={recordsStyles.searchInput}>
            <Search aria-hidden="true" />
            <input
              defaultValue={activity.filters.query}
              maxLength={120}
              name="q"
              placeholder="Player or financial reference"
              type="search"
            />
          </span>
        </label>
        <label>
          <span>Event</span>
          <select defaultValue={activity.filters.eventType} name="eventType">
            <option value="all">All activity</option>
            {activity.eventTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Coach</span>
          <select defaultValue={activity.filters.coachId} name="coachId">
            <option value="all">All coaches</option>
            {activity.coachOptions.map((coach) => <option key={coach.id} value={coach.id}>{coach.name}</option>)}
          </select>
        </label>
        <label><span>From</span><input defaultValue={activity.filters.from} name="from" type="date" /></label>
        <label><span>To</span><input defaultValue={activity.filters.to} name="to" type="date" /></label>
        <button type="submit">Apply filters</button>
      </form>

      {activity.items.length ? (
        <ol className={recordsStyles.activityList}>
          {activity.items.map((item) => (
            <li key={item.id}>
              <div className={recordsStyles.activityTime}>
                <FileClock aria-hidden="true" />
                <time dateTime={item.occurredAt}>{formatFinancialActivityTime(item.occurredAt)}</time>
              </div>
              <div className={recordsStyles.activityBody}>
                <span>Financial activity</span>
                <h3>{item.action}</h3>
                <p>
                  {item.actorName}
                  {item.playerName ? ` · ${item.playerName}` : ""}
                  {item.academyId ? ` · ${item.academyId}` : ""}
                  {item.reference ? ` · ${item.reference}` : ""}
                </p>
                {item.reason ? <blockquote>{item.reason}</blockquote> : null}
              </div>
              {item.amountPaise === null ? null : (
                <strong className={recordsStyles.activityAmount}>{formatFinancialRecordsAmount(item.amountPaise)}</strong>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <EmptyRecords
          body="Change the search or date filters to review another part of the audit history."
          icon={History}
          title="No matching activity"
        />
      )}

      <Pagination pagination={activity.pagination} />
    </section>
  )
}

export function FinancialRecordsWorkspace(props: FinancialRecordsWorkspaceProps) {
  const { activeView } = props
  return (
    <div className={`${financialStyles.workspace} ${financialStyles.recordsWorkspace} page-shell`}>
      <div className={financialStyles.backRow}>
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>

      <header className={`${financialStyles.rapidDeskHeader} ${financialStyles.recordsPageHeader}`}>
        <span className="eyebrow">Financials</span>
        <h1>Fee records</h1>
        <p>Review fee records, collections and the history behind every change.</p>
      </header>

      <RecordsNavigation activeView={activeView} />

      {props.activeView === "fees" ? <FeeRegister register={props.feeRegister} /> : null}
      {props.activeView === "collections" ? <CollectionsDayBook dayBook={props.dayBook} /> : null}
      {props.activeView === "activity" ? <ActivityHistory activity={props.activity} /> : null}
    </div>
  )
}
