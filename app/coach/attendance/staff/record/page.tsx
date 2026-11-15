import { redirect } from "next/navigation"

import { isValidDateKey } from "@/lib/attendance/domain"
import { playerAttendanceRecordHref } from "@/lib/attendance/recording-workspace"
import { academyToday } from "@/lib/clock"

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/**
 * The staff roll call is the first card on the Mark tab now (15 Nov 2026), so
 * this address opens that card on the same date. The Mark tab checks who may
 * see it.
 */
export default async function StaffRollCallPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>
}) {
  const requestedDate = firstQueryValue((await searchParams).date)
  redirect(playerAttendanceRecordHref({
    dateKey: requestedDate && isValidDateKey(requestedDate) ? requestedDate : academyToday(),
    fromCalendar: false,
    occurrenceId: null,
    staffOpen: true,
  }))
}
