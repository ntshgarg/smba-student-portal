import { redirect } from "next/navigation"

import { requireHeadAdminPage } from "@/lib/auth/current-coach"

export const metadata = {
  title: "Staff attendance",
}

export default async function CoachAttendanceCompatibilityPage() {
  await requireHeadAdminPage()
  redirect("/coach/attendance/staff/record")
}
