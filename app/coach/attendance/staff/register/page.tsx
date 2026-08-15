import { StaffAttendanceRegister } from "@/components/coach/staff-attendance-register"
import { buildAttendanceRegisterYearOptions } from "@/lib/attendance/register-workspace"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import {
  listJuniorCoachAttendanceRegisterProfiles,
  listStaffAttendanceRecords,
} from "@/lib/coach/staff-attendance"

export const metadata = {
  title: "Staff attendance register",
}

export default async function StaffAttendanceRegisterPage() {
  const { identity } = await requireHeadAdminPage()
  const referenceDate = getIndiaDateKey()
  const juniorCoaches = listJuniorCoachAttendanceRegisterProfiles({
    requesterAccountId: identity.subjectId,
  })
  const yearOptions = buildAttendanceRegisterYearOptions({
    persistedDateKeys: juniorCoaches.map((coach) => coach.joinedOn),
    today: referenceDate,
  })
  const from = `${yearOptions[0]}-01-01`
  const to = `${yearOptions.at(-1)}-12-31`
  const records = juniorCoaches.flatMap((coach) => listStaffAttendanceRecords({
    requesterAccountId: identity.subjectId,
    coachAccountId: coach.accountId,
    from,
    to,
  }))

  return (
    <StaffAttendanceRegister
      referenceDate={referenceDate}
      yearOptions={yearOptions}
      juniorCoaches={juniorCoaches.map((coach) => ({
        accountId: coach.accountId,
        archivedOn: coach.archivedOn,
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
