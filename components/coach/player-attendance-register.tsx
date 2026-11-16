"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"

import {
  RegisterBand,
  RegisterFilterPill,
  RegisterLegend,
  RegisterMonthBar,
  RegisterPercent,
  RegisterToolbar,
  TileMark,
  registerStyles as styles,
  scrollRegisterToday,
  useRegisterHref,
  useScrollRegisterTodayOnOpen,
} from "@/components/coach/attendance-register-chrome"
import {
  buildAttendanceRegisterMonthDates,
  formatAttendanceRegisterMonth,
} from "@/components/coach/attendance-register-utils"
import {
  useAttendancePortal,
  useMemberPortal,
  useSessionPortal,
} from "@/components/coach/coach-portal-provider"
import {
  attendanceRegisterBatches,
  attendanceRegisterMonthParam,
  attendanceRegisterProgrammes,
  type AttendanceRegisterSelection,
} from "@/lib/attendance/register-workspace"
import { formatSessionLabel, formatSessionTimeRange } from "@/lib/format"
import {
  assignmentCoversOccurrence,
  playerWasEnrolledForOccurrence,
} from "@/lib/sessions/domain"
import { occurrenceIsUpcoming } from "@/lib/sessions/occurrence-time"
import { placeReachesWindow } from "@/lib/sessions/term"
const weekdayShortLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function PlayerAttendanceRegister({
  month: activeMonth,
  monthlyPercents,
  referenceDate,
  referenceInstant: initialReferenceInstant,
  selection,
  yearOptions,
}: {
  /** 1-12: the register shows one month of `selection.year` at a time. */
  month: number
  /**
   * Each player's % for the month, worked out on the server by the family
   * page's own rule over all their places -- so a player who changed level or
   * batch mid-month shows one figure on every tab, the one their family sees.
   */
  monthlyPercents: Readonly<Record<string, number | null>>
  referenceDate: string
  referenceInstant: number
  selection: AttendanceRegisterSelection
  yearOptions: number[]
}) {
  const { players } = useMemberPortal()
  const {
    attendanceAdjustments,
    attendanceRecords,
  } = useAttendancePortal()
  const {
    academyHolidays,
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  } = useSessionPortal()
  const router = useRouter()
  const hrefFor = useRegisterHref()
  const gridRef = useRef<HTMLDivElement>(null)
  const todayKey = referenceDate
  const currentYear = Number(todayKey.slice(0, 4))
  const currentMonth = Number(todayKey.slice(5, 7))
  const activeYear = selection.year
  const selectedProgramme = selection.programme
  const selectedBatch = selection.batch
  const [referenceInstant, setReferenceInstant] = useState(initialReferenceInstant)

  const monthDates = useMemo(
    () => buildAttendanceRegisterMonthDates(activeYear, activeMonth),
    [activeMonth, activeYear],
  )
  const monthLabel = formatAttendanceRegisterMonth(activeYear, activeMonth, "long")
  const categorySeries = sessionSeries.filter((series) => (
    series.programme === selectedProgramme && series.batch === selectedBatch
  ))
  const categorySeriesIds = new Set(categorySeries.map((series) => series.id))
  const categoryOccurrences = sessionOccurrences.filter((occurrence) => categorySeriesIds.has(occurrence.seriesId))
  const occurrenceBySeriesDate = new Map(
    [...categoryOccurrences]
      .sort((first, second) => Number(first.status === "scheduled") - Number(second.status === "scheduled"))
      .map((occurrence) => [`${occurrence.seriesId}:${occurrence.occurrenceDate}`, occurrence]),
  )
  const occurrenceById = new Map(sessionOccurrences.map((occurrence) => [occurrence.id, occurrence]))
  const holidayByDate = new Map(academyHolidays.map((holiday) => [holiday.dateKey, holiday]))
  const yearStart = `${activeYear}-01-01`
  const nextYearStart = `${activeYear + 1}-01-01`
  const playerById = new Map(players.map((player) => [player.member.id, player]))
  const seriesById = new Map(categorySeries.map((series) => [series.id, series]))
  const seriesOrder = new Map(sessionSeries.map((series, index) => [series.id, index]))
  const registerRows = sessionAssignments.flatMap((assignment) => {
    if (!categorySeriesIds.has(assignment.seriesId)) return []
    // The same rule the server applied when it chose these assignments: a
    // schedule that ran out before this year gives no row in it.
    const overlapsDisplayedYear = placeReachesWindow(
      assignment,
      seriesById.get(assignment.seriesId),
      yearStart,
      nextYearStart,
    )
    const coversReplacementInDisplayedYear = categoryOccurrences.some((occurrence) => (
      occurrence.status === "scheduled"
      && occurrence.occurrenceDate >= yearStart
      && occurrence.occurrenceDate < nextYearStart
      && assignmentCoversOccurrence(assignment, occurrence)
    ))
    if (!overlapsDisplayedYear && !coversReplacementInDisplayedYear) return []
    const player = playerById.get(assignment.playerId)
    const series = seriesById.get(assignment.seriesId)
    return player && series ? [{ assignment, player, series }] : []
  }).sort((first, second) => (
    first.player.member.fullName.localeCompare(second.player.member.fullName)
    || (seriesOrder.get(first.series.id) ?? 0) - (seriesOrder.get(second.series.id) ?? 0)
    || first.assignment.id.localeCompare(second.assignment.id)
  ))
  const activeAdjustments = attendanceAdjustments.filter((adjustment) => !adjustment.voidedAt)
  const sourceAdjustmentByCell = new Map(activeAdjustments.map((adjustment) => (
    [`${adjustment.playerId}:${adjustment.sourceOccurrenceId}`, adjustment]
  )))
  const categoryAdjustmentsByPlayer = activeAdjustments.reduce<Map<string, typeof activeAdjustments>>(
    (map, adjustment) => {
      const source = occurrenceById.get(adjustment.sourceOccurrenceId)
      if (!source || !categorySeriesIds.has(source.seriesId)) return map
      const current = map.get(adjustment.playerId) ?? []
      current.push(adjustment)
      map.set(adjustment.playerId, current)
      return map
    },
    new Map(),
  )

  /*
   * Columns are the days this level and batch trains: the weekdays its
   * schedules run on, plus any other date carrying one of its sessions or a
   * completed make-up. A Weekday batch's Saturdays held nothing but "no session"
   * cells, so leaving them out loses no mark and gives every column room for a
   * full tile. A category with no weekly slots at all falls back to every day.
   */
  const trainingWeekdays = new Set(categorySeries.flatMap((series) => series.slots.map((slot) => slot.weekday)))
  const datesWithActivity = new Set([
    ...categoryOccurrences.map((occurrence) => occurrence.occurrenceDate),
    ...[...categoryAdjustmentsByPlayer.values()].flat().map((adjustment) => adjustment.completedOn),
  ])
  const dates = monthDates.filter((date) => (
    trainingWeekdays.has(date.weekday) || datesWithActivity.has(date.key)
  ))
  const visibleDates = dates.length ? dates : monthDates

  const rowCells = registerRows.map((row) => {
    const playerAdjustments = categoryAdjustmentsByPlayer.get(row.player.member.id) ?? []
    const rowAdjustments = playerAdjustments.filter((adjustment) => {
      const source = occurrenceById.get(adjustment.sourceOccurrenceId)
      return Boolean(source
        && source.seriesId === row.series.id
        && playerWasEnrolledForOccurrence(row.player.member.trainingStartOn, source)
        && assignmentCoversOccurrence(row.assignment, source))
    })
    const completionAdjustmentsByDate = rowAdjustments.reduce<Map<string, typeof rowAdjustments>>(
      (map, adjustment) => {
        const current = map.get(adjustment.completedOn) ?? []
        current.push(adjustment)
        map.set(adjustment.completedOn, current)
        return map
      },
      new Map(),
    )
    const slot = row.series.slots[0]
    const sessionLabel = formatSessionLabel({
      programme: row.series.programme,
      batch: row.series.batch,
      startTime: slot?.startTime ?? "",
      durationMinutes: slot?.durationMinutes ?? 0,
    })

    return {
      row,
      sessionLabel,
      cells: visibleDates.map((date) => {
        const occurrence = occurrenceBySeriesDate.get(`${row.series.id}:${date.key}`)
        const unavailable = !occurrence
          || occurrence.status !== "scheduled"
          || !playerWasEnrolledForOccurrence(row.player.member.trainingStartOn, occurrence)
          || !assignmentCoversOccurrence(row.assignment, occurrence)
        const future = occurrence ? occurrenceIsUpcoming(occurrence, referenceInstant) : false
        const choice = occurrence ? attendanceRecords[occurrence.id]?.[row.player.member.id] : undefined
        const adjustment = occurrence
          ? sourceAdjustmentByCell.get(`${row.player.member.id}:${occurrence.id}`)
          : undefined
        const completionAdjustments = completionAdjustmentsByDate.get(date.key) ?? []
        const completionRequiresReview = completionAdjustments.some((item) => item.reviewRequiredAt)
        const holiday = holidayByDate.get(date.key)
        // An upcoming session and a past one nobody has marked must not look
        // alike: the single distinction this register exists to draw.
        const upcoming = future && !choice && !unavailable && !holiday
        const ordinaryState = holiday
          ? `academy closed for ${holiday.label}`
          : unavailable
            ? "not eligible for a scheduled session"
            : future ? "future session" : choice ?? "not recorded"
        const adjustmentState = adjustment?.reviewRequiredAt
          ? "missed session reconciled, requires review"
          : adjustment ? "missed session reconciled" : null
        const completionCount = completionAdjustments.length
        const completionState = completionCount
          ? `${completionCount} completed rescheduled ${completionCount === 1 ? "session" : "sessions"}${completionRequiresReview ? ", requires review" : ""}`
          : null
        const state = [adjustmentState ?? ordinaryState, completionState]
          .filter(Boolean)
          .join("; ")
        return {
          adjustment,
          choice,
          completionAdjustment: completionAdjustments[0],
          completionCount,
          completionRequiresReview,
          date,
          holiday,
          state,
          unavailable,
          upcoming,
        }
      }),
    }
  })
  const playerCount = new Set(registerRows.map((row) => row.player.member.id)).size
  const tableStyle = { "--register-columns": visibleDates.length } as CSSProperties

  // Advanced from the instant the server rendered with, by however much real
  // time has passed, rather than reset to the device's own clock. The register
  // has to notice a session starting while the coach is looking at it, so the
  // 30s tick stays; what changes is whose "now" it counts from.
  //
  // Courtside that removes a dependency on the phone being set correctly: a
  // cell is shown as a future one, and therefore unmarkable, on this comparison alone,
  // so a handset running minutes fast used to decide it for the whole grid.
  //
  // It also keeps the audited DOM still. `academyNow()` can pin the server's
  // clock for the accessibility gate (`lib/clock.ts`); a tick that jumped to the
  // browser's wall clock would un-pin this subtree 30s after load, by the nine
  // days the pin currently holds back today -- and by one more day for every day
  // that passes.
  useEffect(() => {
    const mountedAt = Date.now()
    const timer = window.setInterval(
      () => setReferenceInstant(initialReferenceInstant + (Date.now() - mountedAt)),
      30_000,
    )
    return () => window.clearInterval(timer)
  }, [initialReferenceInstant])

  const showsToday = activeYear === currentYear && activeMonth === currentMonth
  useScrollRegisterTodayOnOpen(gridRef, showsToday)

  function replaceFilters(changes: Record<string, string | null>) {
    router.replace(hrefFor(changes), { scroll: false })
  }

  function jumpToToday() {
    if (!showsToday) {
      replaceFilters({ month: attendanceRegisterMonthParam(currentMonth), year: String(currentYear) })
      return
    }
    scrollRegisterToday(gridRef.current)
  }

  return (
    <div className={styles.register} id="attendance-register">
      <RegisterToolbar people="players" onJumpToToday={jumpToToday}>
        {sessionSeries.length ? (
          <>
            <RegisterFilterPill
              label="Year"
              options={yearOptions}
              value={activeYear}
              onChange={(year) => replaceFilters({ month: null, year })}
            />
            <RegisterFilterPill
              label="Batch"
              options={attendanceRegisterBatches}
              value={selectedBatch}
              onChange={(batch) => replaceFilters({ batch })}
            />
            <RegisterFilterPill
              label="Level"
              options={attendanceRegisterProgrammes}
              value={selectedProgramme}
              onChange={(level) => replaceFilters({ level })}
            />
          </>
        ) : null}
      </RegisterToolbar>

      {!sessionSeries.length ? (
        <div className="coach-register-empty-schedule">
          <h2>No sessions scheduled.</h2>
          <p>Create a recurring schedule and assign players before attendance can be recorded.</p>
          <Link href="/coach/schedules/new">Create schedule</Link>
        </div>
      ) : (
        <>
          <RegisterMonthBar month={activeMonth} year={activeYear} />

          <div className={styles.card}>
            <RegisterBand
              heading={<h2>{selectedProgramme} · {selectedBatch}</h2>}
              month={activeMonth}
              subtitle={`${monthLabel} · ${playerCount} ${playerCount === 1 ? "player" : "players"}`}
              year={activeYear}
              yearOptions={yearOptions}
            />

            {!categorySeries.length ? (
              <div className={styles.empty}>
                <h3>No {selectedProgramme} · {selectedBatch} sessions.</h3>
                <p>Create a matching recurring schedule before recording attendance.</p>
                <Link href="/coach/schedules/new">Create schedule</Link>
              </div>
            ) : !registerRows.length ? (
              <div className={styles.empty}>
                <h3>No players assigned yet.</h3>
                <p>Matching players appear here after they are added to a roster.</p>
                <Link href="/coach/schedules">Open Schedules &amp; Rosters</Link>
              </div>
            ) : (
              <>
                {/* "Made up" and "Needs review" are listed because the grid
                    renders them; the rare `+N` completion count is not, since
                    publish validation keeps it off the normal path. */}
                <RegisterLegend items={["present", "absent", "makeup", "holiday", "unmarked", "upcoming", "review"]} />
                <div
                  className={styles.grid}
                  ref={gridRef}
                  tabIndex={0}
                  role="region"
                  aria-label={`${selectedProgramme} ${selectedBatch} attendance, ${monthLabel}`}
                >
                  <table
                    className={styles.table}
                    style={tableStyle}
                    aria-label={`${selectedProgramme} ${selectedBatch} attendance register for ${monthLabel}`}
                  >
                    <thead>
                      <tr>
                        <th className={styles.name} scope="col">Player</th>
                        {visibleDates.map((date) => {
                          const available = categorySeries.some((series) => (
                            occurrenceBySeriesDate.get(`${series.id}:${date.key}`)?.status === "scheduled"
                          ))
                          const holiday = holidayByDate.get(date.key)
                          return (
                            <th
                              key={date.key}
                              scope="col"
                              data-register-date={date.key}
                              data-register-today={date.key === todayKey || undefined}
                              data-unavailable={!available || undefined}
                              // A struck-out column has to say why, or a holiday
                              // reads exactly like a day this batch does not train.
                              title={holiday ? `${date.label}: closed for ${holiday.label}` : undefined}
                            >
                              <span>{date.day}</span>
                              <strong>{date.date}</strong>
                              {holiday ? <span className="sr-only">Closed for {holiday.label}</span> : null}
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {rowCells.map(({ cells, row, sessionLabel }, rowIndex) => {
                        const firstPlayerRow = rowIndex === 0
                          || registerRows[rowIndex - 1]?.player.member.id !== row.player.member.id
                        const percent = firstPlayerRow
                          ? monthlyPercents[row.player.member.id] ?? null
                          : null
                        const slot = row.series.slots[0]
                        const sessionTimeLabel = formatSessionTimeRange({
                          startTime: slot?.startTime ?? "",
                          durationMinutes: slot?.durationMinutes ?? 0,
                        })
                        const assignedDaysLabel = row.assignment.weekdays
                          .map((weekday) => weekdayShortLabels[weekday])
                          .join(", ")

                        return (
                          <tr key={row.assignment.id} className={firstPlayerRow ? undefined : styles.continuation}>
                            <th
                              className={styles.name}
                              scope="row"
                              aria-label={`${row.player.member.fullName}, ${sessionLabel}, assigned ${assignedDaysLabel}${percent === null ? "" : `, ${percent}% attended in ${monthLabel}`}`}
                            >
                              {firstPlayerRow ? (
                                <span className={styles.who}>
                                  <strong>{row.player.member.fullName}</strong>
                                  <RegisterPercent value={percent} />
                                </span>
                              ) : null}
                              <small>{[sessionTimeLabel, assignedDaysLabel].filter(Boolean).join(" · ")}</small>
                            </th>
                            {cells.map((cell) => {
                              const cellLabel = `${row.player.member.fullName}, ${sessionLabel}, ${cell.date.label}: ${cell.state}.`
                              const title = `${sessionLabel} · ${cell.date.label}: ${cell.state}`
                              const count = cell.completionCount
                                ? <span className={styles.count} aria-hidden="true">+{cell.completionCount}</span>
                                : null

                              return (
                                <td key={cell.date.key}>
                                  {cell.adjustment ? (
                                    <Link
                                      className={`${styles.tile} ${styles.makeup}${cell.adjustment.reviewRequiredAt ? ` ${styles.review}` : ""}`}
                                      href={`/coach/attendance/adjustments?adjustment=${encodeURIComponent(cell.adjustment.id)}&player=${encodeURIComponent(row.player.member.id)}`}
                                      aria-label={`${cellLabel} Open adjustment details.`}
                                      title={title}
                                    >
                                      {count}
                                      <TileMark kind="makeup" />
                                      {cell.adjustment.reviewRequiredAt ? <TileMark kind="review" /> : null}
                                    </Link>
                                  ) : cell.completionAdjustment && cell.unavailable ? (
                                    <Link
                                      className={`${styles.tile} ${styles.completion}${cell.completionRequiresReview ? ` ${styles.review}` : ""}`}
                                      href={`/coach/attendance/adjustments?adjustment=${encodeURIComponent(cell.completionAdjustment.id)}&player=${encodeURIComponent(row.player.member.id)}`}
                                      aria-label={`${cellLabel} Open adjustment details.`}
                                      title={title}
                                    >
                                      {count}
                                      {cell.completionRequiresReview ? <TileMark kind="review" /> : null}
                                    </Link>
                                  ) : (
                                    <span
                                      className={`${styles.tile} ${styles[
                                        cell.holiday ? "holiday"
                                          : cell.unavailable ? "none"
                                            : cell.choice ?? (cell.upcoming ? "upcoming" : cell.completionCount ? "none" : "unmarked")
                                      ]}${cell.completionRequiresReview ? ` ${styles.review}` : ""}`}
                                      role="img"
                                      aria-label={cellLabel}
                                      title={title}
                                    >
                                      {count}
                                      <TileMark kind={cell.holiday ? "holiday" : cell.unavailable ? "none" : cell.choice ?? "none"} />
                                      {cell.completionRequiresReview ? <TileMark kind="review" /> : null}
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
