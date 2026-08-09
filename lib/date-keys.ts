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
