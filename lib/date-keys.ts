export function isValidDateKey(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateKey)) return false
  const [year, month, day] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export function weekdayForDateKey(dateKey: string) {
  if (!isValidDateKey(dateKey)) throw new Error("Invalid date.")
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()
}

export function isValidMonthKey(month: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/u.test(month)
}

/**
 * Half-open `[start, endExclusive)` bounds covering every date key in a month.
 * SQL callers filter with this instead of `LIKE 'YYYY-MM%'`: SQLite only applies
 * its LIKE-to-range optimisation when the indexed column is NOCASE-collated, and
 * every date key here is stored BINARY, so a LIKE scans the whole table.
 * December rolls the year, and the arithmetic reads the key's own digits so no
 * timezone or `Date` parsing is involved.
 *
 * Throws on anything that is not a `YYYY-MM` key, like `weekdayForDateKey` above.
 * A range is not the equivalent of the `LIKE` for a malformed key and cannot be
 * made into one: `LIKE '2026-%'` matched a whole year, whereas the bounds for
 * `"2026"` come out as `["2026-01", "2026-01-01")`, which is empty. Silently
 * selecting nothing is the wrong failure for a publish gate that reads "are
 * there unreviewed adjustments in this month", so the malformed key stops here.
 */
export function monthDateBounds(month: string) {
  if (!isValidMonthKey(month)) throw new Error("Invalid month.")
  const monthIndex = Number(month.slice(5, 7))
  const rollsIntoNextYear = monthIndex === 12
  const nextYear = Number(month.slice(0, 4)) + (rollsIntoNextYear ? 1 : 0)
  const nextMonthIndex = rollsIntoNextYear ? 1 : monthIndex + 1

  return {
    start: `${month}-01`,
    endExclusive: [
      String(nextYear).padStart(4, "0"),
      String(nextMonthIndex).padStart(2, "0"),
      "01",
    ].join("-"),
  }
}
