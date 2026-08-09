import { StaffAttendanceRegister } from "@/components/coach/staff-attendance-register"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import {
  listJuniorCoachProfiles,
  listStaffAttendanceRecords,
} from "@/lib/coach/staff-attendance"

export const metadata = {
  title: "Staff attendance register",
}

export default async function StaffAttendanceRegisterPage() {
  const { identity } = await requireHeadAdminPage()
  const referenceDate = getIndiaDateKey()
  const currentYear = Number(referenceDate.slice(0, 4))
  const from = `${currentYear - 1}-01-01`
  const to = `${currentYear + 2}-12-31`
  const juniorCoaches = listJuniorCoachProfiles({
    requesterAccountId: identity.subjectId,
  })
  const records = juniorCoaches.flatMap((coach) => listStaffAttendanceRecords({
    requesterAccountId: identity.subjectId,
    coachAccountId: coach.accountId,
    from,
    to,
  }))

  return (
    <StaffAttendanceRegister
      referenceDate={referenceDate}
      juniorCoaches={juniorCoaches.map((coach) => ({
        accountId: coach.accountId,
        fullName: coach.fullName,
        joinedOn: coach.joinedOn,
      }))}
      initialRecords={records.map((record) => ({
        coachAccountId: record.coachAccountId,
        dateKey: record.dateKey,
        choice: record.choice,
      }))}
    />
  )
}
