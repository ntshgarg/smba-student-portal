export const ACADEMY_TIME_ZONE = "Asia/Kolkata"

const ACADEMY_LOCALE = "en-IN"
const DATE_KEY_LOCALE = "en-GB"
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u

type DateInput = Date | number | string

function toDate(value: DateInput) {
  return value instanceof Date ? value : new Date(value)
}

export function formatAcademyDate(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(ACADEMY_LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...options,
    timeZone: ACADEMY_TIME_ZONE,
  }).format(toDate(value))
}

/** Format a YYYY-MM-DD calendar key without converting it as an instant. */
export function formatDateKey(
  value: string,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(DATE_KEY_LOCALE, {
    day: "numeric",
    month: "long",
    weekday: "long",
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`))
}

export function formatAcademyTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(ACADEMY_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    ...options,
    timeZone: ACADEMY_TIME_ZONE,
  }).format(toDate(value))
}

export function getAcademyDateKey(value: DateInput = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: ACADEMY_TIME_ZONE,
    year: "numeric",
  }).formatToParts(toDate(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((item) => item.type === type)?.value ?? ""
  )

  return `${part("year")}-${part("month")}-${part("day")}`
}

export function getAcademyMonthKey(value: DateInput = new Date()) {
  return getAcademyDateKey(value).slice(0, 7)
}

export function academyTimeInputValue(value: DateInput) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: ACADEMY_TIME_ZONE,
  }).formatToParts(toDate(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((item) => item.type === type)?.value ?? "00"
  )

  return `${part("hour")}:${part("minute")}`
}

export function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return formatAcademyDate(value, options)
}

export function formatSessionDate(value: string) {
  return {
    weekday: formatAcademyDate(value, {
      day: undefined,
      month: undefined,
      weekday: "long",
      year: undefined,
    }),
    date: formatAcademyDate(value, {
      day: "numeric",
      month: "long",
      year: undefined,
    }),
    time: formatAcademyTime(value),
  }
}

function clockLabel(totalMinutes: number) {
  const normalized = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60)
  const hours24 = Math.floor(normalized / 60)
  const minutes = normalized % 60
  const hours12 = hours24 % 12 || 12
  return {
    time: minutes ? `${hours12}:${String(minutes).padStart(2, "0")}` : String(hours12),
    period: hours24 < 12 ? "am" : "pm",
  }
}

export function formatSessionTimeRange({
  durationMinutes,
  startTime,
}: {
  durationMinutes: number
  startTime: string
}) {
  if (!TIME_PATTERN.test(startTime) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return ""
  }

  const [hours, minutes] = startTime.split(":").map(Number)
  const start = clockLabel(hours * 60 + minutes)
  const end = clockLabel(hours * 60 + minutes + durationMinutes)

  return start.period === end.period
    ? `${start.time}–${end.time} ${start.period}`
    : `${start.time} ${start.period}–${end.time} ${end.period}`
}

/**
 * Human presentation for a session. Stored session titles remain immutable and
 * should never be parsed to build this label.
 */
export function formatSessionLabel({
  batch,
  durationMinutes,
  programme,
  startTime,
}: {
  batch: string
  durationMinutes: number
  programme: string
  startTime: string
}) {
  const context = `${programme.trim()} · ${batch.trim()}`
  const timeRange = formatSessionTimeRange({ durationMinutes, startTime })

  return timeRange ? `${context} · ${timeRange}` : context
}

/** Human session label for an occurrence stored as an absolute instant. */
export function formatSessionLabelFromInstant({
  batch,
  durationMinutes,
  programme,
  startsAt,
}: {
  batch: string
  durationMinutes: number
  programme: string
  startsAt: DateInput
}) {
  return formatSessionLabel({
    batch,
    durationMinutes,
    programme,
    startTime: academyTimeInputValue(startsAt),
  })
}
