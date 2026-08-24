export const ACADEMY_TIME_ZONE = "Asia/Kolkata"

const ACADEMY_LOCALE = "en-IN"
const DATE_KEY_LOCALE = "en-GB"
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u

type DateInput = Date | number | string

function toDate(value: DateInput) {
  return value instanceof Date ? value : new Date(value)
}

/*
 * Constructing an Intl formatter resolves locale data and costs tens of
 * microseconds — measured here at 26 µs for a date formatter — which the
 * helpers below were paying on every call, once per row wherever a list or
 * table renders. `format` and `formatToParts` do not mutate the instance, so
 * calls that would have built identical formatters can share one.
 *
 * The key is the locale followed by every option whose value is defined, sorted
 * by option name. Sorting is what makes it canonical rather than merely
 * convenient. ECMA-402 reads each option by name and never observes the
 * object's enumeration order, so the formatter it builds is a function of the
 * *set* of name/value pairs; sorting turns two spellings of the same set into
 * one key. Discarding undefined values matches `GetOption`, which treats an
 * explicitly undefined option as absent — `formatSessionDate` depends on that,
 * passing `day: undefined` to suppress an inherited default.
 *
 * The property that has to hold is one-directional: equal key must imply equal
 * output. It holds because the key names every input the constructor reads —
 * the locale, and every option that survives to it — with one exception. A
 * formatter built without an explicit `timeZone` binds the host zone at
 * construction, and Node re-resolves that when `process.env.TZ` is reassigned,
 * so a cached instance could outlive the zone it captured. Those are built
 * fresh. Splitting one behaviour across two keys is harmless; merging two
 * behaviours under one key is not, and cannot happen here.
 */
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()
const numberFormatters = new Map<string, Intl.NumberFormat>()

function formatterKey(locale: string, options: object) {
  const values = options as Record<string, unknown>
  let key = locale
  for (const name of Object.keys(options).sort()) {
    const value = values[name]
    if (value === undefined) continue
    /*
     * Tagged with the type because the constructor does not coerce uniformly:
     * it reads hour12 with ToBoolean, where the string "false" is true and the
     * boolean false is not. Untagged, those two would share a key and one
     * formatter would answer for both.
     */
    key += `\u0001${name}\u0002${typeof value}\u0003${String(value)}`
  }

  return key
}

/** Shared `Intl.DateTimeFormat` for callers whose options are decided per call. */
export function dateTimeFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  if (options.timeZone === undefined) return new Intl.DateTimeFormat(locale, options)

  const key = formatterKey(locale, options)
  const cached = dateTimeFormatters.get(key)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat(locale, options)
  dateTimeFormatters.set(key, formatter)
  return formatter
}

/** Shared `Intl.NumberFormat` for callers whose options are decided per call. */
export function numberFormatter(
  locale: string,
  options: Intl.NumberFormatOptions,
) {
  const key = formatterKey(locale, options)
  const cached = numberFormatters.get(key)
  if (cached) return cached

  const formatter = new Intl.NumberFormat(locale, options)
  numberFormatters.set(key, formatter)
  return formatter
}

/**
 * The app's only ₹-symbol presentation of an amount: whole rupees print
 * without decimals, part-rupee amounts print exactly two. Every caller passes
 * paise, because that is the unit every amount is stored and computed in.
 *
 * Four other spellings of an amount survive elsewhere. Three have a reason the
 * ₹ symbol or the grouped digits cannot satisfy; the fourth is a holdout this
 * consolidation left alone. Add a fifth only under one of the first three:
 *   - `money` in `lib/finance/pdf.ts` prints `INR ` because Helvetica has no
 *     U+20B9 — read the note above it before formatting money in a PDF.
 *   - `formatPaise` in `lib/finance/collections-csv.ts` and
 *     `lib/finance/records-csv.ts` emits bare, ungrouped, always-2dp decimals,
 *     because a spreadsheet has to parse the cell back as a number.
 *   - `paiseToRupeesInput` in `components/coach/financials/allocation-draft.ts`
 *     — and the `String(paise / 100)` seeds in `player-ledger.tsx` and
 *     `financials-rapid-desk.tsx` — fills editable amount fields, so what it
 *     writes must survive a round trip through `parseRupeesToPaise`.
 *   - the refund-limit message in `lib/finance/service.ts` hand-builds
 *     `INR <n>.<nn>` and is shown to the coach verbatim by `financeError`. It
 *     has no encoding or parsing excuse — it was left out because folding it in
 *     means re-reading that sentence, not just swapping the call.
 */
export function formatInr(amountPaise: number) {
  /* Fraction digits follow the amount, so this stays per call and shares by option key. */
  return numberFormatter(ACADEMY_LOCALE, {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: amountPaise % 100 ? 2 : 0,
  }).format(amountPaise / 100)
}

export function formatAcademyDate(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
) {
  return dateTimeFormatter(ACADEMY_LOCALE, {
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
  return dateTimeFormatter(DATE_KEY_LOCALE, {
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
  return dateTimeFormatter(ACADEMY_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    ...options,
    timeZone: ACADEMY_TIME_ZONE,
  }).format(toDate(value))
}

/* Options are wholly constant, so one instance beats even a cache lookup. */
const academyDateKeyFormat = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: ACADEMY_TIME_ZONE,
  year: "numeric",
})

export function getAcademyDateKey(value: DateInput = new Date()) {
  const parts = academyDateKeyFormat.formatToParts(toDate(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((item) => item.type === type)?.value ?? ""
  )

  return `${part("year")}-${part("month")}-${part("day")}`
}

export function getAcademyMonthKey(value: DateInput = new Date()) {
  return getAcademyDateKey(value).slice(0, 7)
}

const academyTimeInputFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  timeZone: ACADEMY_TIME_ZONE,
})

export function academyTimeInputValue(value: DateInput) {
  const parts = academyTimeInputFormat.formatToParts(toDate(value))
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
