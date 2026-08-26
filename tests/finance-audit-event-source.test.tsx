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

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
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
  getFinancialActivity: mocks.getFinancialActivity,
  listFinanceActivityCoaches: mocks.listFinanceActivityCoaches,
}))

import { GET as downloadActivity } from "@/app/coach/financials/records/activity.csv/route"
import FinancialRecordsPage from "@/app/coach/financials/records/page"
import {
  FINANCE_AUDIT_EVENTS,
  FINANCE_AUDIT_EVENT_TYPES,
  type FinanceActivityInput,
} from "@/lib/finance/types"

async function renderActivityFilter() {
  const page = await FinancialRecordsPage({ searchParams: Promise.resolve({ view: "activity" }) })
  const markup = renderToStaticMarkup(page)
  const select = /<select[^>]*name="eventType"[^>]*>([\s\S]*?)<\/select>/.exec(markup)
  if (!select) throw new Error("The activity view rendered no event filter.")
  return [...select[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g)]
    .map((option) => ({ label: option[2], value: option[1] }))
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

  it("offers every event type on screen, in declaration order, under its filter label", async () => {
    const options = await renderActivityFilter()

    expect(options[0]).toEqual({ label: "All activity", value: "all" })
    expect(options.slice(1)).toEqual(FINANCE_AUDIT_EVENT_TYPES.map((value) => ({
      label: FINANCE_AUDIT_EVENTS[value].filterLabel,
      value,
    })))
  })

  it("labels the filter with the filter vocabulary, not the activity-row vocabulary", async () => {
    const options = await renderActivityFilter()
    const labelFor = (value: string) => options.find((option) => option.value === value)?.label

    expect(labelFor("training_start_redated")).toBe("Training start date corrected")
    expect(labelFor("concession_reversed")).toBe("Concession reversed")
    expect(FINANCE_AUDIT_EVENTS.concession_reversed.action).toBe("Concession ended")
    expect(labelFor("fee_agreement_replaced")).toBe("Fee plan changed")
    expect(FINANCE_AUDIT_EVENTS.fee_agreement_replaced.action).toBe("Fee plan replaced")
  })

  it.each(FINANCE_AUDIT_EVENT_TYPES)("exports a CSV filtered to %s", async (eventType) => {
    expect(await csvFilterFor(eventType)).toEqual([eventType])
  })

  it("still ignores an event type the audit log cannot produce", async () => {
    expect(await csvFilterFor("not_an_event")).toBeUndefined()
  })
})
