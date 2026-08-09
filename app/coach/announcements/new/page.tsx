import { AnnouncementComposer } from "@/components/coach/announcements/announcement-composer"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { getAcademyDateKey } from "@/lib/format"

export const metadata = {
  title: "New announcement",
}

export default async function NewAnnouncementPage() {
  await requireHeadAdminPage()

  return <AnnouncementComposer academyToday={getAcademyDateKey()} />
}
