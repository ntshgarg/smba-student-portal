"use client"

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { useState } from "react"

import { weekdayForDateKey } from "@/lib/date-keys"
import { formatDateKey } from "@/lib/format"

import styles from "./mark.module.css"

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * The Mark tab's dates: the selected day's week, Monday to Sunday, with ‹ ›
 * for the weeks around it and "Pick a date" for anything further. The strip
 * only moves the view; a date is chosen by tapping a day or picking one, and
 * `onChoose` decides whether the change goes ahead.
 *
 * No dot per day for how far its registers got: the Mark tab reads one day of
 * sessions and marks at a time, so the rest of the week is not on hand.
 */
export function WeekStrip({
  onChoose,
  selectedDate,
}: {
  onChoose: (dateKey: string) => void
  selectedDate: string
}) {
  // Weeks away from the selected day's own week.
  const [weekOffset, setWeekOffset] = useState(0)
  const monday = shiftDateKey(
    selectedDate,
    -((weekdayForDateKey(selectedDate) + 6) % 7) + weekOffset * 7,
  )
  const days = Array.from({ length: 7 }, (_, index) => shiftDateKey(monday, index))

  function choose(dateKey: string) {
    setWeekOffset(0)
    onChoose(dateKey)
  }

  return (
    <nav className={styles.strip} aria-label="Choose a date">
      <button
        type="button"
        className={styles.stripArrow}
        aria-label="Previous week"
        onClick={() => setWeekOffset(weekOffset - 1)}
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <ol className={styles.days}>
        {days.map((dateKey) => (
          <li key={dateKey}>
            <button
              type="button"
              className={styles.day}
              aria-current={dateKey === selectedDate ? "date" : undefined}
              aria-label={formatDateKey(dateKey, { year: "numeric" })}
              onClick={() => choose(dateKey)}
            >
              <span>{formatDateKey(dateKey, { day: undefined, month: undefined, weekday: "short" })}</span>
              <strong>{Number(dateKey.slice(8))}</strong>
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className={styles.stripArrow}
        aria-label="Next week"
        onClick={() => setWeekOffset(weekOffset + 1)}
      >
        <ChevronRight aria-hidden="true" />
      </button>
      <label className={styles.pick}>
        <CalendarDays aria-hidden="true" />
        <span>Pick a date</span>
        <input
          name="attendanceDate"
          type="date"
          value={selectedDate}
          onChange={(event) => choose(event.target.value)}
          onClick={(event) => {
            // The field is the whole "Pick a date" pill, drawn invisible over it,
            // so a click anywhere on the pill opens the calendar. Browsers that
            // refuse (or open it themselves on a tap) need nothing more.
            try {
              event.currentTarget.showPicker()
            } catch {
              // The browser's own behaviour stands.
            }
          }}
        />
      </label>
    </nav>
  )
}
