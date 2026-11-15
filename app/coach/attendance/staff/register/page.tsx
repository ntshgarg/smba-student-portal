import { AttendanceShell } from "@/components/coach/attendance/attendance-shell"
import { StaffAttendanceRegister } from "@/components/coach/staff-attendance-register"
import {
  buildAttendanceRegisterYearOptions,
  resolveAttendanceRegisterMonth,
  type AttendanceRegisterQuery,
} from "@/lib/attendance/register-workspace"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyToday } from "@/lib/clock"
import {
  listJuniorCoachAttendanceRegisterProfiles,
  listStaffAttendanceRecordsByCoach,
} from "@/lib/coach/staff-attendance"
import { listAcademyHolidaysInWindow } from "@/lib/sessions/database"

export const metadata = {
  title: "Staff attendance register",
}

export default async function StaffAttendanceRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Pick<AttendanceRegisterQuery, "month" | "year">>
}) {
  const { identity } = await requireHeadAdminPage()
  const query = await searchParams
  const referenceDate = academyToday()
  const juniorCoaches = listJuniorCoachAttendanceRegisterProfiles({
    requesterAccountId: identity.subjectId,
  })
  const yearOptions = buildAttendanceRegisterYearOptions({
    persistedDateKeys: juniorCoaches.map((coach) => coach.joinedOn),
    today: referenceDate,
  })
  const requestedYear = Number(Array.isArray(query.year) ? query.year[0] : query.year)
  const year = yearOptions.includes(requestedYear)
    ? requestedYear
    : Number(referenceDate.slice(0, 4))
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const recordsByCoach = listStaffAttendanceRecordsByCoach({
    requesterAccountId: identity.subjectId,
    coachAccountIds: juniorCoaches.map((coach) => coach.accountId),
    from,
    to,
  })
  const records = juniorCoaches.flatMap((coach) => recordsByCoach.get(coach.accountId) ?? [])
  const month = resolveAttendanceRegisterMonth({
    activeDateKeys: records.map((record) => record.dateKey),
    query,
    today: referenceDate,
    year,
  })

  return (
    <AttendanceShell activeTab="register">
      <StaffAttendanceRegister
        holidays={listAcademyHolidaysInWindow(from, to)}
        month={month}
        referenceDate={referenceDate}
        year={year}
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
    </AttendanceShell>
  )
}
