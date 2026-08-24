import { redirect } from "next/navigation"

import {
  FinancialRecordsWorkspace,
  type FinancialRecordsPagination,
  type FinancialRecordsView,
} from "@/components/coach/financials/financial-records-workspace"
import { PrepareFees } from "@/components/coach/financials/prepare-fees"
import { isValidDateKey, isValidMonthKey } from "@/lib/attendance/domain"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { initializeDatabase } from "@/lib/db/client"
import { monthEnd } from "@/lib/finance/domain"
import {
  getCollectionsDayBook,
  getCoachMonthlyPreparationPreview,
  getFeeRegister,
  getFinanceActivation,
  getFinancialActivity,
  listFinanceActivityCoaches,
} from "@/lib/finance/service"
import {
  FINANCE_AUDIT_EVENT_TYPES,
  FINANCE_AUDIT_EVENTS,
  isFinanceAuditEventType,
  type FinancePlayerScope,
  type FinanceRegisterMode,
  type FinanceStatus,
} from "@/lib/finance/types"
import { getAcademyMonthKey } from "@/lib/format"

export const metadata = {
  title: "Fee records",
}

const PAGE_SIZE = 10
const COLLECTION_PAGE_SIZE = 10
const ACTIVITY_PAGE_SIZE = 20

const FINANCE_STATUSES: FinanceStatus[] = [
  "pending",
  "partially_paid",
  "overdue",
  "paid",
  "not_prepared",
  "void",
]

const ACTIVITY_TYPES = FINANCE_AUDIT_EVENT_TYPES.map((value) => ({
  label: FINANCE_AUDIT_EVENTS[value].filterLabel,
  value,
}))

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function queryValue(params: SearchParams, key: string) {
  return (firstValue(params[key]) ?? "").trim().slice(0, 120)
}

function validView(value: string): FinancialRecordsView {
  return value === "collections" || value === "activity" ? value : "fees"
}

function validMode(value: string): FinanceRegisterMode {
  return value === "registration" ? "registration" : "monthly"
}

function validScope(value: string): FinancePlayerScope {
  return value === "archived" || value === "all" ? value : "active"
}

function cursorTrail(value: string) {
  if (!value) return []
  const values = value.split(",").filter((item) => item.length > 0 && item.length <= 200)
  return values.length <= 20 ? values : []
}

function recordsUrl(view: FinancialRecordsView, params: Record<string, string | undefined>) {
  const search = new URLSearchParams({ view })
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value)
  })
  return `/coach/financials/records?${search.toString()}`
}

function pagination({
  base,
  count,
  nextCursor,
  pageSize,
  trail,
  view,
}: {
  base: Record<string, string | undefined>
  count: number
  nextCursor: string | null
  pageSize: number
  trail: string[]
  view: FinancialRecordsView
}): FinancialRecordsPagination {
  const first = trail.length * pageSize + (count ? 1 : 0)
  const last = trail.length * pageSize + count
  return {
    label: count ? `${first}–${last}` : "No records",
    nextHref: nextCursor
      ? recordsUrl(view, { ...base, cursors: [...trail, nextCursor].join(",") })
      : null,
    previousHref: trail.length
      ? recordsUrl(view, {
        ...base,
        cursors: trail.slice(0, -1).join(",") || undefined,
      })
      : null,
  }
}

function currentMonthRange(period: string) {
  return { from: `${period}-01`, to: monthEnd(period) }
}

function validCollectionRange(fromValue: string, toValue: string, period: string) {
  const fallback = currentMonthRange(period)
  if (!isValidDateKey(fromValue) || !isValidDateKey(toValue) || fromValue > toValue) return fallback
  const from = Date.parse(`${fromValue}T00:00:00.000Z`)
  const to = Date.parse(`${toValue}T00:00:00.000Z`)
  return (to - from) / 86_400_000 + 1 <= 366
    ? { from: fromValue, to: toValue }
    : fallback
}

function exportHref(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value)
  })
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

export default async function FinancialRecordsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { identity } = await requireHeadAdminPage()

  const database = initializeDatabase()
  if (!getFinanceActivation({ database })) redirect("/coach/financials")

  const params = await searchParams
  const view = validView(queryValue(params, "view"))
  const query = queryValue(params, "q")
  const periodValue = queryValue(params, "period")
  const period = isValidMonthKey(periodValue) ? periodValue : getAcademyMonthKey()
  const trail = cursorTrail(queryValue(params, "cursors"))
  const cursor = trail.at(-1)

  if (view === "fees") {
    const mode = validMode(queryValue(params, "mode"))
    const scope = validScope(queryValue(params, "scope"))
    const statusValue = queryValue(params, "status")
    const status = FINANCE_STATUSES.includes(statusValue as FinanceStatus)
      ? statusValue as FinanceStatus
      : "all"
    const base = {
      mode,
      period: mode === "monthly" ? period : undefined,
      q: query || undefined,
      scope,
      status,
    }
    const register = getFeeRegister({
      cursor,
      limit: PAGE_SIZE,
      mode,
      period: mode === "monthly" ? period : undefined,
      playerScope: scope,
      query,
      statuses: status === "all" ? undefined : [status],
    }, { coachId: identity.subjectId, database })
    const preparation = mode === "monthly"
      ? getCoachMonthlyPreparationPreview(period, {
        coachId: identity.subjectId,
        database,
      })
      : null

    return (
      <FinancialRecordsWorkspace
        activeView="fees"
        feeRegister={{
          exportHref: exportHref("/coach/financials/records/fees.csv", base),
          filters: {
            cursors: trail.join(","),
            mode,
            period,
            query,
            scope,
            status,
          },
          pagination: pagination({
            base,
            count: register.rows.length,
            nextCursor: register.nextCursor,
            pageSize: PAGE_SIZE,
            trail,
            view,
          }),
          preparation: preparation
            ? <PrepareFees compact period={period} preparation={preparation} />
            : null,
          rows: register.rows,
          summary: register.summary,
        }}
      />
    )
  }

  if (view === "collections") {
      const selectedRange = validCollectionRange(
        queryValue(params, "from"),
        queryValue(params, "to"),
        period,
      )
      const includeReversed = ["1", "true", "on"].includes(
        queryValue(params, "includeReversed"),
      )
      const base = {
        from: selectedRange.from,
        to: selectedRange.to,
        includeReversed: includeReversed ? "true" : undefined,
      }
      const dayBook = getCollectionsDayBook({
        ...selectedRange,
        cursor,
        includeReversed,
        limit: COLLECTION_PAGE_SIZE,
      }, { coachId: identity.subjectId, database })

      return (
        <FinancialRecordsWorkspace
          activeView="collections"
          dayBook={{
            events: dayBook.events.map((event) => ({
              ...event,
              paymentId: event.eventType === "payment" ? event.id : null,
            })),
            exportHref: exportHref("/coach/financials/collections.csv", base),
            filters: { ...selectedRange, includeReversed },
            pagination: pagination({
              base,
              count: dayBook.events.length,
              nextCursor: dayBook.nextCursor,
              pageSize: COLLECTION_PAGE_SIZE,
              trail,
              view,
            }),
            summary: dayBook.summary,
          }}
        />
      )
  }

  const fromValue = queryValue(params, "from")
  const toValue = queryValue(params, "to")
  const from = isValidDateKey(fromValue) ? fromValue : ""
  const to = isValidDateKey(toValue) ? toValue : ""
  const validDates = !from || !to || from <= to
  const eventValue = queryValue(params, "eventType")
  const eventType = isFinanceAuditEventType(eventValue) ? eventValue : "all"
  const coachValue = queryValue(params, "coachId")
  const coachOptions = listFinanceActivityCoaches({
    coachId: identity.subjectId,
    database,
  })
  const coachId = coachOptions.some((coach) => coach.id === coachValue) ? coachValue : "all"
  const base = {
    q: query || undefined,
    eventType,
    coachId,
    from: validDates ? from || undefined : undefined,
    to: validDates ? to || undefined : undefined,
  }
  const activity = getFinancialActivity({
    coachId: coachId === "all" ? undefined : coachId,
    cursor,
    eventTypes: eventType === "all" ? undefined : [eventType],
    from: validDates ? from || undefined : undefined,
    limit: ACTIVITY_PAGE_SIZE,
    query,
    to: validDates ? to || undefined : undefined,
  }, { coachId: identity.subjectId, database })

  return (
    <FinancialRecordsWorkspace
      activeView="activity"
      activity={{
        coachOptions,
        eventTypeOptions: ACTIVITY_TYPES,
        exportHref: exportHref("/coach/financials/records/activity.csv", base),
        filters: {
          coachId,
          eventType,
          from: validDates ? from : "",
          query,
          to: validDates ? to : "",
        },
        items: activity.items,
        pagination: pagination({
          base,
          count: activity.items.length,
          nextCursor: activity.nextCursor,
          pageSize: ACTIVITY_PAGE_SIZE,
          trail,
          view,
        }),
      }}
    />
  )
}
