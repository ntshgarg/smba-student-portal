import { renderToStaticMarkup } from "react-dom/server"

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PlayerMemberRecord } from "@/lib/coach/types"
import type { MonthlyPreparationPreview } from "@/lib/finance/types"
import type { EndScheduleResult, EndScheduleRosterPlayer } from "@/lib/sessions/service"
import type { SessionAssignment, TrainingSessionSeries } from "@/lib/sessions/types"
import type {
  MemberFeeSummary,
  MemberTrainingSummaries,
  MemberTrainingSummary,
} from "@/lib/training/member-summaries"

const portal = vi.hoisted(() => ({
  formShells: [] as Array<{ eyebrow?: string; onConfirm: () => void }>,
  sessionAssignments: [] as unknown[],
  sessionSeries: [] as unknown[],
}))

// Records each form's props, so a test can press its confirm button.
vi.mock("@/components/coach/members/directory/form-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/coach/members/directory/form-shell")>()
  const { createElement } = await import("react")
  return {
    FormShell: (props: Parameters<typeof actual.FormShell>[0]) => {
      portal.formShells.push(props as unknown as { eyebrow?: string; onConfirm: () => void })
      return createElement(actual.FormShell, props)
    },
  }
})

vi.mock("next/navigation", () => ({
  usePathname: () => "/coach/members",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/components/coach/coach-portal-provider", () => ({
  useMemberDirectoryPortal: () => ({
    sessionAssignments: portal.sessionAssignments,
    sessionSeries: portal.sessionSeries,
  }),
  useSessionPortal: () => ({
    endSessionSeries: vi.fn(),
    previewEndSessionSeries: vi.fn(() => new Promise(() => undefined)),
  }),
}))

// The buttons call server actions; nothing here presses them.
vi.mock("@/app/coach/members/training-actions", () => ({}))
vi.mock("@/app/coach/financials/actions", () => ({}))

import {
  EndSchedulePanel,
  endScheduleGroups,
  endScheduleSummary,
} from "@/components/coach/calendar/end-schedule-panel"
import { PrepareFees } from "@/components/coach/financials/prepare-fees"
import { MemberTrainingActions } from "@/components/coach/members/directory/member-training-actions"
import { MemberTrainingProvider } from "@/components/coach/members/directory/member-training-context"
import {
  feePlanEndRoute,
  financialCloseoutMessage,
} from "@/components/coach/members/directory/use-member-directory"

const today = "2026-11-12"

function series(id: string, overrides: Partial<TrainingSessionSeries> = {}): TrainingSessionSeries {
  return {
    batch: "Weekday",
    endsOn: "2027-03-31",
    id,
    programme: "Beginner",
    slots: [{ durationMinutes: 60, id: `${id}-slot`, startTime: "06:00", weekday: 1 }],
    startsOn: "2026-07-01",
    status: "active",
    title: id,
    venue: "SMBA Court",
    ...overrides,
  }
}

function assignment(playerId: string, seriesId: string): SessionAssignment {
  return {
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    id: `${playerId}-${seriesId}`,
    playerId,
    seriesId,
    weekdays: [1],
  }
}

function player(id: string, training: Partial<PlayerMemberRecord["training"]> = {}): PlayerMemberRecord {
  return {
    member: {
      academyId: "SMBA#0002",
      fullName: `Player ${id}`,
      id,
      initials: "PL",
      onboardingCompletedAt: "2026-07-01T00:00:00.000Z",
      primaryContact: { name: "", phone: "", relationship: "" },
      role: "player",
      trainingStartOn: "2026-07-01",
    },
    training: {
      academyPlan: "weekday-5-day",
      activeSessionIds: [],
      ageGroup: "Under 13",
      batch: "Weekday",
      level: "Beginner",
      memberId: id,
      recordRevision: 0,
      status: "paused",
      termFinishedOn: null,
      ...training,
    },
  }
}

function fee(overrides: Partial<MemberFeeSummary> = {}): MemberFeeSummary {
  return {
    activeAgreementId: "agreement",
    activeAgreementRevision: 1,
    concession: null,
    feeChangeStartsOn: "2026-12-01",
    monthlyFeePaise: 400_000,
    nextMonthFeePaise: 400_000,
    nextMonthNoFee: "no-schedule",
    thisMonth: null,
    waitingFeeChange: null,
    ...overrides,
  }
}

function render(record: PlayerMemberRecord, summary: Partial<MemberTrainingSummary>) {
  const value: MemberTrainingSummaries = {
    financeActive: true,
    nextMonthStart: "2026-12-01",
    summaries: {
      [record.member.id]: { failed: null, fee: fee(), note: null, scheduled: null, ...summary },
    },
    today,
  }
  return renderToStaticMarkup(
    <MemberTrainingProvider value={value}>
      <MemberTrainingActions player={record} />
    </MemberTrainingProvider>,
  )
}

describe("a player's record in Members", () => {
  beforeEach(() => {
    portal.sessionAssignments = [assignment("finished", "autumn"), assignment("running", "season")]
    portal.sessionSeries = [series("autumn", { endsOn: "2026-10-31" }), series("season")]
  })

  it("offers Stop fees for a kept fee plan on no schedule with nothing booked", () => {
    const html = render(player("resting"), {})
    expect(html).toContain(">Stop fees<")
    expect(html).toContain("stop fees to end the fee plan")
    expect(html).toContain(">Start training<")
  })

  it("keeps End training as the way for a player still on a schedule, finished term included", () => {
    const finished = render(player("finished", { status: "finished", termFinishedOn: "2026-10-31" }), {
      fee: fee({ nextMonthNoFee: "term-finished" }),
    })
    expect(finished).not.toContain(">Stop fees<")
    expect(finished).toContain(">End training<")

    const running = render(player("running", { status: "active" }), { fee: fee({ nextMonthNoFee: null }) })
    expect(running).not.toContain(">Stop fees<")
  })

  it("leaves a booking as arranged: no Stop fees while something is booked", () => {
    const html = render(player("resting"), {
      scheduled: {
        academyPlan: "weekday-5-day",
        batch: "Weekday",
        effectiveOn: "2026-12-01",
        id: "booked",
        kind: "change",
        level: "Beginner",
        monthlyFeePaise: 400_000,
        seriesId: "season",
        stopFees: false,
        weekdays: [1],
      },
    })
    expect(html).not.toContain(">Stop fees<")
  })

  it("offers to cancel a fee change waiting for next month", () => {
    const html = render(player("running", { status: "active" }), {
      fee: fee({
        nextMonthFeePaise: 450_000,
        nextMonthNoFee: null,
        waitingFeeChange: {
          agreementId: "next",
          feePaise: 450_000,
          previousFeePaise: 400_000,
          revision: 0,
          startsOn: "2026-12-01",
        },
      }),
    })
    expect(html).toContain(">Cancel this fee change<")
    expect(html).toContain("New fee of ₹4,500 starts with December 2026&#x27;s fee. Cancel it to keep ₹4,000 a month.")
    expect(render(player("running", { status: "active" }), { fee: fee({ nextMonthNoFee: null }) }))
      .not.toContain("Cancel this fee change")
  })

  it("shows a booking End schedule cancelled as a plain note, and a failure in red, each with Dismiss", () => {
    const note = render(player("resting"), {
      note: "Booked move to Beginner · Weekday · 6–7 am cancelled: that schedule was ended on 12 November 2026.",
    })
    expect(note).toContain("Booked move to Beginner · Weekday · 6–7 am cancelled: that schedule was ended on 12 November 2026")
    expect(note).toContain("inline-notice is-info")
    expect(note).not.toContain("is-error")
    expect(note).toContain(">Dismiss<")

    const failed = render(player("resting"), {
      failed: { effectiveOn: "2026-11-01", reason: "Choose an active schedule." },
    })
    expect(failed).toContain("could not be applied: Choose an active schedule")
    expect(failed).toContain("inline-notice is-error")
    expect(failed).toContain(">Dismiss<")
  })
})

describe("Issue fees", () => {
  function preparation(overrides: Partial<MonthlyPreparationPreview> = {}): MonthlyPreparationPreview {
    return {
      alreadyPrepared: 0,
      awaitingAssignment: 3,
      ready: 6,
      setupRequired: 1,
      skipped: [
        { fullName: "Chitra Nair", playerId: "chitra", reason: "on_break" },
        { fullName: "Mohan Reddy", playerId: "mohan", reason: "term_finished" },
        { fullName: "Nina George", playerId: "nina", reason: "level_changed" },
      ],
      ...overrides,
    }
  }

  it("names who it skips, with the reason and a link to each record; a break is folded away", () => {
    const html = renderToStaticMarkup(
      <PrepareFees compact currentPeriod="2026-12" period="2026-12" preparation={preparation()} />,
    )
    expect(html).toContain("Not issued: 3 players have a fee plan but no schedule in December")
    expect(html).toContain("Term finished · 1")
    expect(html).toContain("Level changed since the fee plan · 1")
    expect(html).toContain('<details><summary>On a break (fee plan kept) · 1</summary>')
    expect(html).toContain('href="/coach/members?player=mohan">Mohan Reddy</a>')
    expect(html).toContain('href="/coach/members?player=chitra">Chitra Nair</a>')
    expect(html.indexOf("Mohan Reddy")).toBeLessThan(html.indexOf("Chitra Nair"))
  })

  it("says nothing extra when nobody is skipped", () => {
    const html = renderToStaticMarkup(
      <PrepareFees compact currentPeriod="2026-12" period="2026-12" preparation={preparation({ skipped: [] })} />,
    )
    expect(html).not.toContain("Not issued:")
  })
})

describe("End schedule's confirm panel", () => {
  it("asks first, in place of a browser confirm box", () => {
    const html = renderToStaticMarkup(
      <EndSchedulePanel
        busy={false}
        finished={false}
        label="Beginner · Weekday · 6–7 am"
        lastDay="2027-03-31"
        onCancel={() => undefined}
        onConfirm={() => undefined}
        seriesId="season"
        today={today}
      />,
    )
    expect(html).toContain("End Beginner · Weekday · 6–7 am")
    expect(html).toContain("Checking who is on this schedule")
    // Nothing can be ended until it knows who is on it.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>End schedule<\/button>/u)
  })

  it("sums up what End schedule did from the lists it returned", () => {
    const person = (fullName: string) => ({ fullName, playerId: fullName })
    const closeout: EndScheduleResult = {
      alreadyEnded: false,
      bookingCancelled: [{ ...person("Esha Das"), schedule: "Beginner · Weekday · 6–7 pm" }],
      bookingKept: [person("Chitra Nair")],
      cancelledOccurrences: 4,
      closedAssignments: 3,
      endsPlacesOn: today,
      feesStopped: [person("Asha Rao")],
      inOnboarding: [],
      keptActive: [person("Bala Iyer")],
      takenOff: [person("Asha Rao"), person("Bala Iyer"), person("Chitra Nair")],
    }
    expect(endScheduleSummary(closeout, "November 2026")).toEqual([
      "Taken off: Asha Rao, Bala Iyer, Chitra Nair",
      "Still training on another schedule, fees unchanged: Bala Iyer",
      "Booked change kept as arranged: Chitra Nair",
      "Booking onto this schedule cancelled (their record says so): Esha Das",
      "Fees stop after November 2026: Asha Rao",
    ])
  })

  it("says a repeat press changed nothing, instead of claiming nobody was on it", () => {
    const repeat: EndScheduleResult = {
      alreadyEnded: true,
      bookingCancelled: [],
      bookingKept: [],
      cancelledOccurrences: 0,
      closedAssignments: 0,
      endsPlacesOn: null,
      feesStopped: [],
      inOnboarding: [],
      keptActive: [],
      takenOff: [],
    }
    const lines = endScheduleSummary(repeat, "November 2026")
    expect(lines).toEqual([
      "This schedule had already been ended, so nothing more was changed. Each player's record in Members shows what changed.",
    ])
    expect(lines.join(" ")).not.toContain("Nobody was on it")
  })

  it("counts as paused everyone the write pauses, booked change or not", () => {
    const rosterPlayer = (fullName: string, overrides: Partial<EndScheduleRosterPlayer> = {}): EndScheduleRosterPlayer => ({
      bookingKept: null,
      bookingOntoThis: null,
      fullName,
      hasFeePlan: true,
      inOnboarding: false,
      onAnotherSchedule: false,
      placeElsewhere: false,
      playerId: fullName,
      ...overrides,
    })
    const groups = endScheduleGroups([
      rosterPlayer("Asha"),
      rosterPlayer("Bala", { onAnotherSchedule: true, placeElsewhere: true }),
      // End training booked, no other place: paused today, booking kept.
      rosterPlayer("Chitra", { bookingKept: { effectiveOn: "2026-12-01", kind: "end" } }),
      // Other place is on a finished term: stays as they are, not paused.
      rosterPlayer("Hari", { placeElsewhere: true }),
    ])
    const names = (list: readonly { fullName: string }[]) => list.map((item) => item.fullName)
    expect(names(groups.paused)).toEqual(["Asha", "Chitra"])
    expect(names(groups.keptBooking)).toEqual(["Chitra"])
    expect(names(groups.withFeePlans)).toEqual(["Asha", "Hari"])
  })

  it("sends the on-screen default, Stop fees, even when the fee question is not shown", () => {
    portal.formShells.length = 0
    const onConfirm = vi.fn()
    renderToStaticMarkup(
      <EndSchedulePanel
        busy={false}
        finished={false}
        label="Beginner · Weekday · 6–7 am"
        lastDay="2027-03-31"
        onCancel={() => undefined}
        onConfirm={onConfirm}
        seriesId="season"
        today={today}
      />,
    )
    const shell = portal.formShells.find((props) => props.eyebrow === "End schedule")
    shell!.onConfirm()
    expect(onConfirm).toHaveBeenCalledWith(true)
  })
})

describe("Archive's fee plan refusal", () => {
  const refusal = {
    code: "FINANCIAL_CLOSEOUT_REQUIRED" as const,
    hasOpenFeePlan: true,
    hasOutstandingBalance: false,
    message: "",
    ok: false as const,
    outstandingPaise: 0,
  }
  const booked = (kind: "change" | "end", stopFees: boolean) => ({ effectiveOn: "2026-12-01", kind, stopFees })

  it("points to the action the record actually offers", () => {
    const message = (route: string) => financialCloseoutMessage(refusal as Parameters<typeof financialCloseoutMessage>[0], route)
    expect(message(feePlanEndRoute(null, false)))
      .toBe("Before archiving, end the player’s Fee Plan with Stop fees above")
    // Stop fees is hidden while a change is booked.
    expect(message(feePlanEndRoute(booked("end", false), false)))
      .toBe("Before archiving, cancel the booked change above, then end the player’s Fee Plan with Stop fees")
    expect(message(feePlanEndRoute(booked("end", true), false)))
      .toBe("Before archiving, wait for the End training booked for 1 Dec 2026, which ends the player’s Fee Plan")
    // Stop fees is hidden while they still have a place: End training it is.
    expect(message(feePlanEndRoute(null, true)))
      .toBe("Before archiving, end the player’s Fee Plan with End training above (Stop fees after this month)")
  })
})
