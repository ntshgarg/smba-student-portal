import { PlayerOnboardingRegister } from "@/components/coach/onboarding/player-onboarding-register"
import { listRejectedRegistrations } from "@/lib/auth/account-service"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyNow, academyToday } from "@/lib/clock"
import {
  getPlayerOnboardingWorkspace,
} from "@/lib/coach/database"
import { getFinanceActivation } from "@/lib/finance/service"
import { listSessionSeries } from "@/lib/sessions/database"
import { REGISTRATION_REQUEST_RETENTION_DAYS } from "@/lib/telemetry/retention"

export const metadata = {
  title: "Academy Onboarding",
}

const DAY_MS = 24 * 60 * 60 * 1000

export default async function CoachOnboardingPage() {
  await requireHeadAdminPage()
  const now = academyNow()
  const today = academyToday()
  const workspace = getPlayerOnboardingWorkspace(today)
  // A rejected request is deleted 90 days after the rejection (lib/telemetry/retention.ts).
  const rejectedRequests = listRejectedRegistrations().map((request) => ({
    ...request,
    removedInDays: request.rejectedAt
      ? Math.ceil(
        (Date.parse(request.rejectedAt) + REGISTRATION_REQUEST_RETENTION_DAYS * DAY_MS - now.getTime()) / DAY_MS,
      )
      : null,
  }))

  return (
    <PlayerOnboardingRegister
      financeActive={Boolean(getFinanceActivation())}
      referenceDate={today}
      rejectedRequests={rejectedRequests}
      sessionSeries={listSessionSeries()}
      workspace={workspace}
    />
  )
}
