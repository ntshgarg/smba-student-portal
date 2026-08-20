import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCoachFinanceRapidDesk: vi.fn(),
  getFinanceActivation: vi.fn(),
  initializeDatabase: vi.fn(),
  requireHeadAdminPage: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/components/coach/financials/financials-activation", () => ({
  FinancialsActivation: ({ initialPeriod }: { initialPeriod: string }) => (
    <div data-period={initialPeriod}>Activate Financials</div>
  ),
}))
vi.mock("@/components/coach/financials/financials-rapid-desk", () => ({
  FinancialsRapidDesk: ({
    initialQuery,
    workspace,
  }: {
    initialQuery: string
    workspace: { scope: string }
  }) => <div data-query={initialQuery} data-scope={workspace.scope}>Record payment</div>,
}))
vi.mock("@/components/coach/financials/view-model", () => ({
  toRapidFinancialWorkspaceView: (workspace: unknown) => workspace,
}))
vi.mock("@/lib/auth/current-coach", () => ({
  requireHeadAdminPage: mocks.requireHeadAdminPage,
}))
vi.mock("@/lib/db/client", () => ({
  initializeDatabase: mocks.initializeDatabase,
}))
vi.mock("@/lib/finance/service", () => ({
  getCoachFinanceRapidDesk: mocks.getCoachFinanceRapidDesk,
  getFinanceActivation: mocks.getFinanceActivation,
}))
vi.mock("@/lib/format", () => ({
  getAcademyMonthKey: () => "2026-08",
}))

import CoachFinancialsPage from "@/app/coach/financials/page"
import FinancialsRapidDeskPage from "@/app/coach/financials/record/page"
import { FinancialsCard } from "@/components/coach/financials/financials-card"

describe("coach Financials entry points", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireHeadAdminPage.mockResolvedValue({
      access: { accessLevel: "head_admin" },
      identity: {
        fullName: "Sathiya Moorthy",
        role: "coach",
        subjectId: "coach-1",
      },
    })
    mocks.initializeDatabase.mockReturnValue({})
    mocks.getCoachFinanceRapidDesk.mockReturnValue({
      period: "2026-08",
      players: [],
      scope: "outstanding",
      selectedLedger: null,
    })
  })

  it("keeps the inactive dashboard card focused on setup", () => {
    const html = renderToStaticMarkup(
      <FinancialsCard
        active={false}
        attentionCount={0}
        outstandingPaise={0}
        period="2026-08"
        preparation={{ alreadyPrepared: 0, ready: 0 }}
      />,
    )

    expect(html).toContain("Set up Financials")
    expect(html).toContain("/coach/financials?period=2026-08")
    expect(html).not.toContain("Record payment")
    expect(html).not.toContain("Fee records are ready")
    expect(html).not.toContain("Monthly fees")
  })

  it.each([
    [{ ready: 4, alreadyPrepared: 1 }, "August fees ready to issue"],
    [{ ready: 0, alreadyPrepared: 5 }, "August fees issued"],
    [{ ready: 0, alreadyPrepared: 0 }, "No monthly fees to issue"],
  ])("shows the active preparation state and equal operational destinations", (preparation, label) => {
    const html = renderToStaticMarkup(
      <FinancialsCard
        active
        attentionCount={2}
        outstandingPaise={700_000}
        period="2026-08"
        preparation={preparation}
      />,
    )

    expect(html).toContain(label)
    expect(html).toContain("2 records need attention")
    expect(html).toContain("₹7,000 outstanding")
    expect(html).toContain('href="/coach/financials/record"')
    expect(html).toContain("/coach/financials/records?view=fees&amp;mode=monthly&amp;period=2026-08")
  })

  it("preserves activation at the legacy root until Financials is active", async () => {
    mocks.getFinanceActivation.mockReturnValue(null)

    const page = await CoachFinancialsPage({
      searchParams: Promise.resolve({ period: "2026-07" }),
    })

    expect(renderToStaticMarkup(page)).toContain('data-period="2026-07"')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("redirects an active legacy player link to that focused fee record", async () => {
    mocks.getFinanceActivation.mockReturnValue({ trackingMonth: "2026-08" })

    await expect(CoachFinancialsPage({
      searchParams: Promise.resolve({ player: "player id/42", period: "2026-07" }),
    })).rejects.toThrow("NEXT_REDIRECT")

    expect(mocks.redirect).toHaveBeenLastCalledWith(
      "/coach/financials/players/player%20id%2F42?mode=monthly&period=2026-07&scope=active&status=all",
    )
  })

  it("redirects a bare active legacy root to the current-month Fee Register", async () => {
    mocks.getFinanceActivation.mockReturnValue({ trackingMonth: "2026-08" })

    await expect(CoachFinancialsPage({
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NEXT_REDIRECT")

    expect(mocks.redirect).toHaveBeenLastCalledWith(
      "/coach/financials/records?view=fees&mode=monthly&period=2026-08",
    )
  })

  it("preserves a valid legacy period and maps query to the Fee Register search", async () => {
    mocks.getFinanceActivation.mockReturnValue({ trackingMonth: "2026-08" })

    await expect(CoachFinancialsPage({
      searchParams: Promise.resolve({
        period: "2026-07",
        query: "  Aarav  ",
        view: "overdue",
      }),
    })).rejects.toThrow("NEXT_REDIRECT")

    expect(mocks.redirect).toHaveBeenLastCalledWith(
      "/coach/financials/records?view=fees&mode=monthly&period=2026-07&q=Aarav",
    )
  })

  it("preserves focused-player register context while discarding the obsolete view", async () => {
    mocks.getFinanceActivation.mockReturnValue({ trackingMonth: "2026-08" })

    await expect(CoachFinancialsPage({
      searchParams: Promise.resolve({
        period: "2026-07",
        player: "player-42",
        query: "Aarav",
        view: "paid",
      }),
    })).rejects.toThrow("NEXT_REDIRECT")

    expect(mocks.redirect).toHaveBeenLastCalledWith(
      "/coach/financials/players/player-42?mode=monthly&period=2026-07&scope=active&status=all&q=Aarav",
    )
  })

  it("clamps Record Payment search input before loading its focused read model", async () => {
    mocks.getFinanceActivation.mockReturnValue({ trackingMonth: "2026-08" })
    const longQuery = `  ${"A".repeat(140)}  `

    const page = await FinancialsRapidDeskPage({
      searchParams: Promise.resolve({ query: longQuery, scope: "all" }),
    })

    expect(mocks.getCoachFinanceRapidDesk).toHaveBeenCalledWith({
      period: "2026-08",
      playerId: undefined,
      query: "A".repeat(120),
      scope: "all",
    }, {
      coachId: "coach-1",
      database: {},
    })
    expect(renderToStaticMarkup(page)).toContain(`data-query="${"A".repeat(120)}"`)
  })

  it("removes a non-payable player selection while preserving scope and search", async () => {
    mocks.getFinanceActivation.mockReturnValue({ trackingMonth: "2026-08" })

    await expect(FinancialsRapidDeskPage({
      searchParams: Promise.resolve({
        player: "settled-player",
        query: "  Bina Settled  ",
        scope: "all",
      }),
    })).rejects.toThrow("NEXT_REDIRECT")

    expect(mocks.redirect).toHaveBeenLastCalledWith(
      "/coach/financials/record?scope=all&query=Bina+Settled",
    )
  })

  it("returns a stale default-scope player selection to the bare Record Payment finder", async () => {
    mocks.getFinanceActivation.mockReturnValue({ trackingMonth: "2026-08" })

    await expect(FinancialsRapidDeskPage({
      searchParams: Promise.resolve({
        player: "stale-player",
        scope: "outstanding",
      }),
    })).rejects.toThrow("NEXT_REDIRECT")

    expect(mocks.redirect).toHaveBeenLastCalledWith("/coach/financials/record")
  })
})
