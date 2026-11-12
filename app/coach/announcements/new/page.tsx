import { AnnouncementComposer } from "@/components/coach/announcements/announcement-composer"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyNow } from "@/lib/clock"

export const metadata = {
  title: "New announcement",
}

export default async function NewAnnouncementPage() {
  await requireHeadAdminPage()

  return <AnnouncementComposer academyNowMs={academyNow().getTime()} />
}
