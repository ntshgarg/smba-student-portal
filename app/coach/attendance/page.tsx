import { redirect } from "next/navigation"

import { requireHeadAdminPage } from "@/lib/auth/current-coach"

export const metadata = {
  title: "Record attendance",
}

export default async function CoachAttendancePage() {
  await requireHeadAdminPage()
  redirect("/coach/attendance/players/record")
}
