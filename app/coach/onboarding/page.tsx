import { PlayerOnboardingRegister } from "@/components/coach/onboarding/player-onboarding-register"
import { requireHeadAdminPage } from "@/lib/auth/current-coach"
import { academyToday } from "@/lib/clock"
import {
  getPlayerOnboardingWorkspace,
} from "@/lib/coach/database"
import { getFinanceActivation } from "@/lib/finance/service"
import { listSessionSeries } from "@/lib/sessions/database"

export const metadata = {
  title: "Academy Onboarding",
}

export default async function CoachOnboardingPage() {
  await requireHeadAdminPage()
  const today = academyToday()
  const workspace = getPlayerOnboardingWorkspace(today)

  return (
    <PlayerOnboardingRegister
      financeActive={Boolean(getFinanceActivation())}
      referenceDate={today}
      sessionSeries={listSessionSeries()}
      workspace={workspace}
    />
  )
}
