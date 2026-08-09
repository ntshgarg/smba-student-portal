import { redirect } from "next/navigation"

import { StaffRollCall } from "@/components/coach/attendance/staff-roll-call"
import { isValidDateKey } from "@/lib/attendance/domain"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import {
  listJuniorCoachProfiles,
  listStaffAttendanceRecords,
} from "@/lib/coach/staff-attendance"

export const metadata = {
  title: "Staff roll call",
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function StaffRollCallPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>
}) {
  const { identity } = await requireHeadAdminPage()
  const query = await searchParams
  const requestedDate = firstQueryValue(query.date)
  const today = getIndiaDateKey()
  const selectedDate = requestedDate && isValidDateKey(requestedDate)
    ? requestedDate
    : today

  if (requestedDate !== selectedDate) {
    redirect(`/coach/attendance/staff/record?date=${encodeURIComponent(selectedDate)}`)
  }

  const juniorCoaches = listJuniorCoachProfiles({
    requesterAccountId: identity.subjectId,
  })
  const records = juniorCoaches.flatMap((coach) => listStaffAttendanceRecords({
    requesterAccountId: identity.subjectId,
    coachAccountId: coach.accountId,
    from: selectedDate,
    to: selectedDate,
  }))

  return (
    <StaffRollCall
      key={selectedDate}
      initialDate={selectedDate}
      initialRecords={records.map((record) => ({
        choice: record.choice,
        coachAccountId: record.coachAccountId,
      }))}
      juniorCoaches={juniorCoaches.map((coach) => ({
        accountId: coach.accountId,
        fullName: coach.fullName,
        initials: coach.initials,
        joinedOn: coach.joinedOn,
      }))}
      referenceDate={today}
    />
  )
}
