import { renderToStaticMarkup } from "react-dom/server"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  getCollectionsDayBook: vi.fn(),
  getCoachMonthlyPreparationPreview: vi.fn(),
  getCurrentIdentity: vi.fn(),
  getFeeRegister: vi.fn(),
  getFinanceActivation: vi.fn(),
  getFinancialActivity: vi.fn(),
  initializeDatabase: vi.fn(),
  listFinanceActivityCoaches: vi.fn(),
  requireHeadAdminAccess: vi.fn(),
  requireHeadAdminPage: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ replace: vi.fn() }) }))
vi.mock("@/lib/auth/coach-access", () => ({
  requireHeadAdminAccess: mocks.requireHeadAdminAccess,
}))
vi.mock("@/lib/auth/current-coach", () => ({
  requireHeadAdminPage: mocks.requireHeadAdminPage,
}))
vi.mock("@/lib/data", () => ({
  sessionProvider: { getCurrentIdentity: mocks.getCurrentIdentity },
}))
vi.mock("@/lib/db/client", () => ({ initializeDatabase: mocks.initializeDatabase }))
vi.mock("@/lib/finance/service", () => ({
  FinanceServiceError: class FinanceServiceError extends Error {},
  getCollectionsDayBook: mocks.getCollectionsDayBook,
  getCoachMonthlyPreparationPreview: mocks.getCoachMonthlyPreparationPreview,
  getFeeRegister: mocks.getFeeRegister,
  getFinanceActivation: mocks.getFinanceActivation,
  countFinancialActivity: () => ({}),
  getFinancialActivity: mocks.getFinancialActivity,
  listFinanceActivityCoaches: mocks.listFinanceActivityCoaches,
}))

import { GET as downloadActivity } from "@/app/coach/financials/records/activity.csv/route"
import FinancialRecordsPage from "@/app/coach/financials/records/page"
import { ACTIVITY_GROUPS } from "@/lib/finance/records-filters"
import {
  FINANCE_AUDIT_EVENTS,
  FINANCE_AUDIT_EVENT_TYPES,
  type FinanceActivityInput,
} from "@/lib/finance/types"

async function renderActivityChips(search: Record<string, string> = {}) {
  const page = await FinancialRecordsPage({ searchParams: Promise.resolve({ view: "activity", ...search }) })
  const markup = renderToStaticMarkup(page)
  const chips = /<nav[^>]*aria-label="Filter by kind"[^>]*>([\s\S]*?)<\/nav>/.exec(markup)
  if (!chips) throw new Error("The activity view rendered no kind filter.")
  return [...chips[1].matchAll(/<a([^>]*)>([^<]*)/g)].map((chip) => ({
    current: chip[1].includes('aria-current="page"'),
    eventType: /eventType=([a-z_]+)/.exec(chip[1])?.[1] ?? "all",
    label: chip[2],
  }))
}

async function csvFilterFor(eventType: string) {
  mocks.getFinancialActivity.mockReturnValue({ items: [], nextCursor: null })
  await downloadActivity(new Request(
    `https://academy.example/coach/financials/records/activity.csv?eventType=${eventType}`,
  ))
  const [input] = mocks.getFinancialActivity.mock.calls[0] as [FinanceActivityInput]
  return input.eventTypes
}

describe("finance audit event types reach every consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentIdentity.mockResolvedValue({ role: "coach", subjectId: "coach-1" })
    mocks.requireHeadAdminAccess.mockReturnValue({ accessLevel: "head_admin" })
    mocks.requireHeadAdminPage.mockResolvedValue({
      access: { accessLevel: "head_admin" },
      identity: { fullName: "Sathiya Moorthy", role: "coach", subjectId: "coach-1" },
    })
    mocks.initializeDatabase.mockReturnValue({})
    mocks.getFinanceActivation.mockReturnValue({ trackingMonth: "2026-08" })
    mocks.listFinanceActivityCoaches.mockReturnValue([])
    mocks.getFinancialActivity.mockReturnValue({ items: [], nextCursor: null })
  })

  it("puts every event type under exactly one kind chip", async () => {
    const chips = await renderActivityChips()

    expect(chips.map((chip) => chip.eventType)).toEqual(["all", ...ACTIVITY_GROUPS.map((group) => group.key)])
    for (const eventType of FINANCE_AUDIT_EVENT_TYPES) {
      expect(ACTIVITY_GROUPS.filter((group) => (group.eventTypes as readonly string[]).includes(eventType)))
        .toHaveLength(1)
    }
  })

  it("names one event type from an older link with the filter vocabulary, not the activity-row vocabulary", async () => {
    for (const [eventType, label] of [
      ["training_start_redated", "Training start date corrected"],
      ["concession_reversed", "Concession reversed"],
      ["fee_agreement_replaced", "Fee plan changed"],
    ]) {
      const chips = await renderActivityChips({ eventType })
      expect(chips.find((chip) => chip.current)).toMatchObject({ eventType, label })
    }
    expect(FINANCE_AUDIT_EVENTS.concession_reversed.action).toBe("Concession ended")
    expect(FINANCE_AUDIT_EVENTS.fee_agreement_replaced.action).toBe("Fee plan replaced")
  })

  it.each(ACTIVITY_GROUPS)("exports a CSV filtered to the $label chip", async (group) => {
    expect(await csvFilterFor(group.key)).toEqual(group.eventTypes)
  })

  it.each(FINANCE_AUDIT_EVENT_TYPES)("exports a CSV filtered to %s", async (eventType) => {
    expect(await csvFilterFor(eventType)).toEqual([eventType])
  })

  it("still ignores an event type the audit log cannot produce", async () => {
    expect(await csvFilterFor("not_an_event")).toBeUndefined()
  })
})
