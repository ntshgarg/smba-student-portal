import { randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import type { ReactElement } from "react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { FinancialRecordsWorkspaceProps } from "@/components/coach/financials/financial-records-workspace"

/*
 * Paging through Fee records the way the head coach does: open the list, press
 * Next until it runs out. Next on page 4 used to open "Financials are
 * unavailable" once a list passed 40 rows, because the page trail in the
 * address was cut to 120 characters (four 36-character ids is 147).
 */
const mocks = vi.hoisted(() => ({
  coachId: "",
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: mocks.redirect }))
vi.mock("@/lib/auth/current-coach", () => ({
  requireHeadAdminPage: vi.fn(async () => ({ identity: { subjectId: mocks.coachId } })),
}))
// The page's props are what is under test, not the workspace's markup.
vi.mock("@/components/coach/financials/financial-records-workspace", () => ({
  FinancialRecordsWorkspace: () => null,
}))
vi.mock("@/components/coach/financials/prepare-fees", () => ({ PrepareFees: () => null }))
vi.mock("@/components/coach/financials/financial-player-record-workspace", () => ({
  FinancialPlayerRecordWorkspace: () => null,
}))

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smba-records-paging-"))
process.env.DB_FILE_NAME = path.join(temporaryDirectory, "smba-test.db")

const PLAYER_COUNT = 45
const PAYMENT_COUNT = 47
const EVENT_COUNT = 110

describe("paging through Fee records", () => {
  let page: typeof import("@/app/coach/financials/records/page")["default"]
  let trail: typeof import("@/lib/finance/records-trail")
  let playerPage: typeof import("@/app/coach/financials/players/[playerId]/page")["default"]
  const playerIds: string[] = []

  async function open(search: Record<string, string>) {
    const element = await page({ searchParams: Promise.resolve({ view: "fees", ...search }) }) as ReactElement<FinancialRecordsWorkspaceProps>
    return element.props
  }

  /** Presses Next until it runs out; returns each page's range label and row ids. */
  async function walk(
    search: Record<string, string>,
    rowsOf: (props: FinancialRecordsWorkspaceProps) => { ids: string[]; pagination: { label: string; nextHref?: string | null } },
  ) {
    const labels: string[] = []
    const ids: string[] = []
    let current = search
    for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
      const view = rowsOf(await open(current))
      labels.push(view.pagination.label)
      ids.push(...view.ids)
      if (!view.pagination.nextHref) break
      current = searchOf(view.pagination.nextHref)
    }
    return { ids, labels }
  }

  function searchOf(href: string) {
    return Object.fromEntries(new URL(href, "https://portal.test").searchParams)
  }

  beforeAll(async () => {
    const schema = await import("@/lib/db/schema")
    const finance = await import("@/lib/finance/service")
    const { academyCurrentMonth } = await import("@/lib/clock")
    const accountService = await import("@/lib/auth/account-service")
    const { prepareDatabase } = await import("@/lib/db/setup")
    const database = prepareDatabase({ seed: true })
    page = (await import("@/app/coach/financials/records/page")).default
    playerPage = (await import("@/app/coach/financials/players/[playerId]/page")).default
    trail = await import("@/lib/finance/records-trail")
    const coach = accountService.findApprovedAccountByAcademyId("SMBA#0001")
    if (!coach) throw new Error("Seed coach was not created.")
    mocks.coachId = coach.accountId
    const createdAt = new Date("2026-01-01T04:30:00.000Z")
    finance.activateFinance({
      idempotencyKey: "records-paging-activation",
      trackingMonth: academyCurrentMonth(),
    }, { coachId: coach.accountId, database })

    // Every player trains on one schedule, so each month's fee is one Issue
    // fees would issue: a "Not issued" row for every player.
    const seriesId = randomUUID()
    database.insert(schema.sessionSeries).values({
      batch: "Weekday",
      createdAt,
      createdByAccountId: coach.accountId,
      id: seriesId,
      programme: "Beginner",
      startsOn: "2026-01-01",
      status: "active",
      title: "Paging Beginner Weekday",
      venue: "SMBA Court",
    }).run()

    // Real 36-character ids: the length is what used to break the trail.
    for (let index = 0; index < PLAYER_COUNT; index += 1) {
      const playerId = randomUUID()
      playerIds.push(playerId)
      database.insert(schema.accounts).values({
        approvalStatus: "approved",
        approvedAt: createdAt,
        createdAt,
        fullName: `Paging Player ${String(index).padStart(2, "0")}`,
        id: playerId,
        normalizedName: `paging player ${String(index).padStart(2, "0")}`,
        requestedRole: "player",
        role: "player",
        updatedAt: createdAt,
      }).run()
      database.insert(schema.academyIdAllocations).values({
        accountId: playerId,
        createdAt,
        serial: 5_000 + index,
      }).run()
      database.insert(schema.playerEnrollments).values({
        academyPlan: "weekday-3-day",
        accountId: playerId,
        batch: "Weekday",
        level: "Beginner",
        onboardingCompletedAt: createdAt,
        status: "active",
        trainingStartOn: "2026-01-01",
        updatedAt: createdAt,
      }).run()
      database.insert(schema.feeAgreements).values({
        academyPlan: "weekday-3-day",
        agreedMonthlyFeePaise: 300_000,
        batch: "Weekday",
        createdAt,
        createdByAccountId: coach.accountId,
        currency: "INR",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        id: randomUUID(),
        level: "Beginner",
        monthlyDueDay: 5,
        playerAccountId: playerId,
        recordRevision: 0,
        status: "active",
        updatedAt: createdAt,
        updatedByAccountId: coach.accountId,
      }).run()
      database.insert(schema.sessionAssignments).values({
        accountId: playerId,
        assignedAt: createdAt,
        assignedByAccountId: coach.accountId,
        effectiveFrom: "2026-01-01",
        id: randomUUID(),
        seriesId,
      }).run()
    }

    // Collections this month and activity entries, each with real 36-character
    // ids, so both lists also run past page 5.
    const month = academyCurrentMonth()
    for (let index = 0; index < PAYMENT_COUNT; index += 1) {
      const id = randomUUID()
      database.insert(schema.payments).values({
        amountPaise: 100_000 + index,
        id,
        idempotencyKey: `paging-payment-${index}`,
        method: "cash",
        payloadFingerprint: `paging-payment-${index}`,
        playerAccountId: playerIds[index % PLAYER_COUNT],
        receiptReference: `SMBA-R-PAGING-${String(index).padStart(5, "0")}`,
        receivedOn: `${month}-01`,
        recordedAt: new Date(createdAt.getTime() + index * 1_000),
        recordedByAccountId: coach.accountId,
      }).run()
    }
    for (let index = 0; index < EVENT_COUNT; index += 1) {
      database.insert(schema.financialAuditEvents).values({
        actorAccountId: coach.accountId,
        entityId: randomUUID(),
        entityType: "charge",
        eventType: "charge_issued",
        id: randomUUID(),
        metadata: "{}",
        occurredAt: new Date(createdAt.getTime() + index * 60_000),
      }).run()
    }
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it("steps through every page of a list longer than 40 rows with Next", async () => {
    const seen: string[] = []
    const labels: string[] = []
    let search: Record<string, string> = {}
    for (let pageNumber = 1; pageNumber <= 10; pageNumber += 1) {
      const props = await open(search)
      if (props.activeView !== "fees") throw new Error("Expected the fee register.")
      seen.push(...props.feeRegister.rows.map((row) => row.playerId))
      labels.push(props.feeRegister.pagination.label)
      const next = props.feeRegister.pagination.nextHref
      if (!next) break
      search = searchOf(next)
    }

    expect(labels).toEqual(["1–10", "11–20", "21–30", "31–40", "41–45"])
    expect(new Set(seen).size).toBe(PLAYER_COUNT)
    expect([...seen].sort()).toEqual([...playerIds].sort())
  })

  it("steps back with Previous to the page it came from", async () => {
    const first = await open({})
    if (first.activeView !== "fees") throw new Error("Expected the fee register.")
    let search = searchOf(first.feeRegister.pagination.nextHref!)
    for (let step = 0; step < 3; step += 1) {
      const props = await open(search)
      if (props.activeView !== "fees") throw new Error("Expected the fee register.")
      search = searchOf(props.feeRegister.pagination.nextHref!)
    }
    const fifth = await open(search)
    if (fifth.activeView !== "fees") throw new Error("Expected the fee register.")
    const fourth = await open(searchOf(fifth.feeRegister.pagination.previousHref!))
    if (fourth.activeView !== "fees") throw new Error("Expected the fee register.")
    expect(fourth.feeRegister.pagination.label).toBe("31–40")
  })

  it("steps through Collections past page 5", async () => {
    const result = await walk({ view: "collections" }, (props) => {
      if (props.activeView !== "collections") throw new Error("Expected Collections.")
      return { ids: props.dayBook.events.map((event) => event.id), pagination: props.dayBook.pagination }
    })
    expect(result.labels).toEqual(["1–10", "11–20", "21–30", "31–40", "41–47"])
    expect(new Set(result.ids).size).toBe(PAYMENT_COUNT)
  })

  it("steps through Activity past page 5, with and without a search", async () => {
    const rowsOf = (props: FinancialRecordsWorkspaceProps) => {
      if (props.activeView !== "activity") throw new Error("Expected Activity.")
      return { ids: props.activity.items.map((item) => item.id), pagination: props.activity.pagination }
    }
    // Without a search the database cuts each page; with one, the page is cut
    // after the search, so both ways of paging are walked.
    const plain = await walk({ view: "activity" }, rowsOf)
    const searched = await walk({ view: "activity", q: "Sathiya" }, rowsOf)
    for (const result of [plain, searched]) {
      expect(result.labels.length).toBeGreaterThanOrEqual(6)
      expect(result.labels.at(-1)).toMatch(new RegExp(`–${result.ids.length}$`, "u"))
      expect(new Set(result.ids).size).toBe(result.ids.length)
      expect(result.ids.length).toBeGreaterThanOrEqual(EVENT_COUNT)
    }
  })

  it("keeps the player record's Back link on the page it came from", async () => {
    const pages: string[][] = [[]]
    for (let step = 0; step < 4; step += 1) {
      const props = await open({ cursors: pages.at(-1)!.join(",") })
      if (props.activeView !== "fees") throw new Error("Expected the fee register.")
      pages.push(searchOf(props.feeRegister.pagination.nextHref!).cursors!.split(","))
    }
    const fifthPageTrail = pages.at(-1)!
    expect(fifthPageTrail).toHaveLength(4)

    const element = await playerPage({
      params: Promise.resolve({ playerId: playerIds[0] }),
      searchParams: Promise.resolve({ cursors: fifthPageTrail.join(","), mode: "monthly", scope: "active" }),
    }) as ReactElement<{ backHref: string }>
    const back = searchOf(element.props.backHref)
    expect(back.cursors!.split(",")).toEqual(fifthPageTrail)
    const returned = await open(back)
    if (returned.activeView !== "fees") throw new Error("Expected the fee register.")
    expect(returned.feeRegister.pagination.label).toBe("41–45")
  })

  it("starts again from page 1, with a note, when the page's anchor no longer matches", async () => {
    mocks.redirect.mockClear()
    // An anchor that matches no row: a player who left the filtered list.
    await expect(open({ cursors: [playerIds[0], randomUUID()].join(",") }))
      .rejects.toThrow("NEXT_REDIRECT:")
    const restart = searchOf(mocks.redirect.mock.calls[0]![0])
    expect(restart).toMatchObject({ restarted: "1", view: "fees" })
    expect(restart.cursors).toBeUndefined()

    const restarted = await open(restart)
    if (restarted.activeView !== "fees") throw new Error("Expected the fee register.")
    expect(restarted.notice).toMatch(/starts again from the first page/u)
    expect(restarted.feeRegister.pagination.label).toBe("1–10")
    // The note is for this visit only: Next does not carry it on.
    expect(searchOf(restarted.feeRegister.pagination.nextHref!).restarted).toBeUndefined()
  })

  it("keeps the coach's search and filters when a list starts again", async () => {
    mocks.redirect.mockClear()
    await expect(open({ cursors: randomUUID(), q: "Paging", scope: "all", status: "not_prepared" }))
      .rejects.toThrow("NEXT_REDIRECT:")
    expect(searchOf(mocks.redirect.mock.calls[0]![0])).toMatchObject({
      q: "Paging",
      restarted: "1",
      scope: "all",
      status: "not_prepared",
      view: "fees",
    })

    mocks.redirect.mockClear()
    await expect(open({ cursors: randomUUID(), q: "Sathiya", view: "activity" }))
      .rejects.toThrow("NEXT_REDIRECT:")
    expect(searchOf(mocks.redirect.mock.calls[0]![0])).toMatchObject({ q: "Sathiya", restarted: "1", view: "activity" })
  })

  it("stops offering Next at the page limit and says why, instead of jumping back to page 1", async () => {
    // Only the last anchor is read, so a long trail can be built from one
    // real row that has more rows after it.
    const first = await open({})
    if (first.activeView !== "fees") throw new Error("Expected the fee register.")
    const firstPageLast = first.feeRegister.rows.at(-1)!.playerId
    const longest = Array.from({ length: trail.RECORDS_PAGE_LIMIT - 1 }, () => firstPageLast)
    const props = await open({ cursors: longest.join(",") })
    if (props.activeView !== "fees") throw new Error("Expected the fee register.")
    expect(props.feeRegister.rows).toHaveLength(10)
    expect(props.feeRegister.pagination.nextHref).toBeNull()
    expect(props.feeRegister.pagination.endNote).toMatch(/as far as the list pages/u)
    expect(props.feeRegister.pagination.previousHref).not.toBeNull()
  })
})

describe("reading the page trail", () => {
  it("reads a trail whole, however many 36-character ids it holds", async () => {
    const { readRecordsTrail } = await import("@/lib/finance/records-trail")
    const ids = Array.from({ length: 30 }, () => randomUUID())
    expect(readRecordsTrail(ids.join(","))).toEqual(ids)
    expect(readRecordsTrail([ids.join(","), "ignored"])).toEqual(ids)
  })

  it("reads a malformed or over-long trail as page 1", async () => {
    const { RECORDS_PAGE_LIMIT, readRecordsTrail, recordsTrailCanGrow } = await import("@/lib/finance/records-trail")
    expect(readRecordsTrail(undefined)).toEqual([])
    expect(readRecordsTrail("")).toEqual([])
    expect(readRecordsTrail("a,,b")).toEqual([])
    expect(readRecordsTrail("x".repeat(201))).toEqual([])
    const atLimit = Array.from({ length: RECORDS_PAGE_LIMIT - 1 }, (_, index) => `id-${index}`)
    expect(readRecordsTrail(atLimit.join(","))).toHaveLength(RECORDS_PAGE_LIMIT - 1)
    expect(readRecordsTrail([...atLimit, "one-more"].join(","))).toEqual([])
    expect(recordsTrailCanGrow(atLimit.slice(0, -1))).toBe(true)
    expect(recordsTrailCanGrow(atLimit)).toBe(false)
  })
})
