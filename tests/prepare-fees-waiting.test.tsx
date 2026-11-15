import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/coach/financials/actions", () => ({ prepareMonthlyChargesAction: vi.fn() }))

import { PrepareFees } from "@/components/coach/financials/prepare-fees"

/*
 * A player whose fee waits for a booked training change is left out of the
 * month's issue. The dashboard said so; the panel where fees are issued did not,
 * so the count there silently fell short.
 */
function render(waitingForChange: number) {
  return renderToStaticMarkup(
    <PrepareFees
      currentPeriod="2026-11"
      period="2026-11"
      preparation={{ alreadyPrepared: 0, awaitingAssignment: 0, ready: 3, setupRequired: 0, waitingForChange }}
    />,
  )
}

describe("the Issue fees panel", () => {
  it("names the players whose fee waits for a training change", () => {
    expect(render(2)).toContain("2 players’ fees wait for a training change booked in Members")
    expect(render(1)).toContain("1 player’s fee waits for a training change booked in Members")
    expect(render(0)).not.toContain("training change")
  })
})
