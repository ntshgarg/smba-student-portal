import { PlayerOnboardingRegister } from "@/components/coach/onboarding/player-onboarding-register"
import { listRejectedRegistrations } from "@/lib/auth/account-service"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyNow, academyToday } from "@/lib/clock"
import {
  getPlayerOnboardingWorkspace,
} from "@/lib/coach/database"
import { getFinanceActivation } from "@/lib/finance/service"
import { listSessionSeries } from "@/lib/sessions/database"
import {
  daysUntilRegistrationRequestRemoved,
  listPendingRegistrationRequestsExpiringSoon,
} from "@/lib/telemetry/retention"

export const metadata = {
  title: "Academy Onboarding",
}

export default async function CoachOnboardingPage() {
  await requireHeadAdminPage()
  const now = academyNow()
  const today = academyToday()
  const workspace = getPlayerOnboardingWorkspace(today)
  const rejectedRequests = listRejectedRegistrations().map((request) => ({
    ...request,
    removedInDays: request.rejectedAt
      ? daysUntilRegistrationRequestRemoved(new Date(request.rejectedAt), now)
      : null,
  }))

  return (
    <PlayerOnboardingRegister
      financeActive={Boolean(getFinanceActivation())}
      referenceDate={today}
      rejectedRequests={rejectedRequests}
      requestsExpiringSoon={listPendingRegistrationRequestsExpiringSoon({ now })}
      sessionSeries={listSessionSeries()}
      workspace={workspace}
    />
  )
}
