export type CoachPublishedReportsSearchParams = {
  month?: string
  period?: string
  player?: string
  q?: string
  shown?: string
}

const REPORT_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u
const REPORT_SHOWN_PATTERN = /^\d+$/u

export const PUBLISHED_REPORT_INITIAL_COUNT = 10
export const PUBLISHED_REPORT_REVEAL_INCREMENT = 10

export function isCompletedReportPeriod(
  value: string | undefined,
  latestCompletedPeriod: string,
): value is string {
  return Boolean(
    value
    && REPORT_PERIOD_PATTERN.test(value)
    && value <= latestCompletedPeriod,
  )
}

export function resolveCoachReportArchivePeriod(
  value: string | undefined,
  latestCompletedPeriod: string,
) {
  return isCompletedReportPeriod(value, latestCompletedPeriod)
    ? value
    : latestCompletedPeriod
}

export function normalizeCoachReportArchiveQuery(value: string | undefined) {
  return value?.trim().replace(/\s+/gu, " ").slice(0, 100) ?? ""
}

export function normalizeCoachReportArchiveShown(
  value: string | undefined,
  total: number,
) {
  const safeTotal = Number.isSafeInteger(total) && total > 0 ? total : 0
  if (safeTotal === 0) return 0

  const initialCount = Math.min(PUBLISHED_REPORT_INITIAL_COUNT, safeTotal)
  if (!value || !REPORT_SHOWN_PATTERN.test(value)) return initialCount

  const requested = Number(value)
  if (!Number.isSafeInteger(requested) || requested <= initialCount) return initialCount
  if (requested >= safeTotal) return safeTotal

  return initialCount + Math.floor(
    (requested - initialCount) / PUBLISHED_REPORT_REVEAL_INCREMENT,
  ) * PUBLISHED_REPORT_REVEAL_INCREMENT
}

export function nextCoachReportArchiveShown(current: number, total: number) {
  return Math.min(total, current + PUBLISHED_REPORT_REVEAL_INCREMENT)
}

export function normalizeCoachReportArchiveReturnShown(value: string | undefined) {
  if (!value || !REPORT_SHOWN_PATTERN.test(value)) return null
  const shown = Number(value)
  return Number.isSafeInteger(shown) && shown > PUBLISHED_REPORT_INITIAL_COUNT
    ? shown
    : null
}

export function getCoachReportArchiveHref({
  period,
  query = "",
  shown,
}: {
  period: string
  query?: string
  shown?: number | null
}) {
  const parameters = new URLSearchParams({ period })
  if (query.trim()) parameters.set("q", query.trim())
  if (shown && shown > PUBLISHED_REPORT_INITIAL_COUNT) {
    parameters.set("shown", String(shown))
  }
  return `/coach/reports?${parameters.toString()}`
}

export function getCoachReportPublicationHref(
  publicationId: string,
  archive: {
    period: string
    query?: string
    shown?: number | null
  },
) {
  const archiveHref = getCoachReportArchiveHref(archive)
  const queryIndex = archiveHref.indexOf("?")
  return `/coach/reports/publications/${encodeURIComponent(publicationId)}${archiveHref.slice(queryIndex)}`
}

export function getLegacyCoachReportWriterHref(
  query: CoachPublishedReportsSearchParams,
) {
  if (!query.month && !query.player) return null

  const search = new URLSearchParams()
  if (query.month) search.set("month", query.month)
  if (query.player) search.set("player", query.player)
  return `/coach/reports/write?${search.toString()}`
}
