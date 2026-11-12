import { renderToStaticMarkup } from "react-dom/server"

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PlayerMemberRecord } from "@/lib/coach/types"
import type { SessionAssignment, TrainingSessionSeries } from "@/lib/sessions/types"
import type {
  MemberFeeSummary,
  MemberScheduledChange,
  MemberTrainingSummaries,
} from "@/lib/training/member-summaries"

const portal = vi.hoisted(() => ({
  players: [] as unknown[],
  sessionAssignments: [] as unknown[],
  sessionSeries: [] as unknown[],
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/coach/schedules",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/components/coach/coach-portal-provider", () => ({
  useMemberDirectoryPortal: () => ({
    sessionAssignments: portal.sessionAssignments,
    sessionSeries: portal.sessionSeries,
  }),
  useMemberPortal: () => ({ players: portal.players }),
  useSessionPortal: () => ({
    endSessionSeries: vi.fn(),
    sessionAssignments: portal.sessionAssignments,
    sessionSeries: portal.sessionSeries,
  }),
}))

// The record's buttons call server actions; nothing here presses them.
vi.mock("@/app/coach/members/training-actions", () => ({}))

import { SessionSchedules } from "@/components/coach/calendar/session-schedules"
import { MemberSummaryRow } from "@/components/coach/members/directory/member-summary-row"
import { MemberTrainingActions } from "@/components/coach/members/directory/member-training-actions"
import { MemberTrainingProvider } from "@/components/coach/members/directory/member-training-context"
import { MemberTrainingPanel } from "@/components/coach/members/directory/member-training-panel"
import { TermFinishedCard } from "@/components/coach/term-finished-card"

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

function player(
  id: string,
  training: Partial<PlayerMemberRecord["training"]> = {},
): PlayerMemberRecord {
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
      activeSessionIds: ["autumn"],
      ageGroup: "Under 13",
      batch: "Weekday",
      level: "Beginner",
      memberId: id,
      recordRevision: 0,
      status: "active",
      termFinishedOn: null,
      ...training,
    },
  }
}

const finishedPlayer = player("finished", { status: "finished", termFinishedOn: "2026-10-31" })

describe("the coach dashboard's term-finished to-do", () => {
  it("links the head coach to Members filtered to the players to move", () => {
    const html = renderToStaticMarkup(<TermFinishedCard playerCount={3} />)

    expect(html).toContain('data-area="todo"')
    expect(html).toContain("Term finished: 3 players to move")
    // Players only: the status filter does not apply to coaches, so without
    // the role every coach would follow the players to move.
    expect(html).toContain('href="/coach/members?status=finished&amp;role=players"')
    expect(html).toContain('data-tone="attention"')
  })

  it("does not appear while nobody needs moving", () => {
    expect(renderToStaticMarkup(<TermFinishedCard playerCount={0} />)).toBe("")
    expect(renderToStaticMarkup(<TermFinishedCard playerCount={1} />))
      .toContain("Term finished: 1 player to move")
  })
})

function bookedChange(kind: "change" | "end"): MemberScheduledChange {
  return {
    academyPlan: kind === "change" ? "weekday-5-day" : null,
    batch: kind === "change" ? "Weekday" : null,
    effectiveOn: "2026-12-01",
    id: `booked-${kind}`,
    kind,
    level: kind === "change" ? "Beginner" : null,
    monthlyFeePaise: kind === "change" ? 450_000 : null,
    seriesId: kind === "change" ? "season" : null,
    stopFees: false,
    weekdays: kind === "change" ? [1] : [],
  }
}

describe("Members shows a finished term", () => {
  it("marks the row and the training panel with the date", () => {
    const row = renderToStaticMarkup(
      <table><tbody>
        <MemberSummaryRow
          activeSessionLabels={["Beginner · Weekday · Mon (term finished 31 October 2026)"]}
          index={0}
          isExpanded={false}
          onOpen={() => undefined}
          player={finishedPlayer}
        />
      </tbody></table>,
    )
    expect(row).toContain('class="coach-member-status is-finished"')
    expect(row).toContain(">Term finished<")
    expect(row).toContain("1 finished")
    expect(row).not.toContain("1 active")

    const panel = renderToStaticMarkup(
      <MemberTrainingPanel
        activeSessionLabels={["Beginner · Weekday · Mon (term finished 31 October 2026)"]}
        player={finishedPlayer}
      />,
    )
    expect(panel).toContain("Term finished on 31 October 2026")
    expect(panel).toContain("(term finished 31 October 2026)")
  })

  it("says on the row when a term-finished player's move or end is already booked", () => {
    function row(scheduled: MemberScheduledChange | null) {
      const value: MemberTrainingSummaries = {
        financeActive: true,
        nextMonthStart: "2026-12-01",
        summaries: { finished: { failed: null, fee: null, note: null, scheduled } },
        today,
      }
      return renderToStaticMarkup(
        <MemberTrainingProvider value={value}>
          <table><tbody>
            <MemberSummaryRow
              activeSessionLabels={["Beginner · Weekday · Mon (term finished 31 October 2026)"]}
              index={0}
              isExpanded={false}
              onOpen={() => undefined}
              player={finishedPlayer}
            />
          </tbody></table>
        </MemberTrainingProvider>,
      )
    }

    expect(row(bookedChange("change"))).toContain("1 finished · change scheduled")
    expect(row(bookedChange("end"))).toContain("1 finished · change scheduled")
    // Still "Term finished" until the change happens on its day.
    expect(row(bookedChange("change"))).toContain(">Term finished<")
    expect(row(null)).not.toContain("change scheduled")
  })

  function fee(overrides: Partial<MemberFeeSummary> = {}): MemberFeeSummary {
    return {
      activeAgreementId: "agreement",
      activeAgreementRevision: 1,
      concession: null,
      feeChangeStartsOn: "2026-12-01",
      monthlyFeePaise: 400_000,
      nextMonthFeePaise: 400_000,
      nextMonthNoFee: null,
      thisMonth: null,
      waitingFeeChange: null,
      ...overrides,
    }
  }

  function nextMonthLine(html: string) {
    return html.match(/<dt>From December 2026<\/dt><dd>([^<]*)<\/dd>/u)?.[1]
  }

  function renderActions(
    record: PlayerMemberRecord,
    summary: MemberFeeSummary,
    scheduled: MemberScheduledChange | null = null,
  ) {
    const value: MemberTrainingSummaries = {
      financeActive: true,
      nextMonthStart: "2026-12-01",
      summaries: { [record.member.id]: { failed: null, fee: summary, note: null, scheduled } },
      today,
    }
    return renderToStaticMarkup(
      <MemberTrainingProvider value={value}>
        <MemberTrainingActions player={record} />
      </MemberTrainingProvider>,
    )
  }

  beforeEach(() => {
    portal.sessionAssignments = [assignment("finished", "autumn"), assignment("running", "season")]
    portal.sessionSeries = [series("autumn", { endsOn: "2026-10-31" }), series("season")]
  })

  it("says why next month has no fee and offers no fee change without a running place", () => {
    const html = renderActions(finishedPlayer, fee({ nextMonthNoFee: "term-finished" }))

    expect(nextMonthLine(html)).toBe("No fee: term finished")
    expect(html).toContain("Move them to a schedule first to change their fee.")
    expect(html).not.toContain(">Change fee<")
    // Moving them on is unchanged.
    expect(html).toContain(">Change schedule<")
    expect(html).toContain(">End training<")
  })

  it("points a booked move's fee to the scheduled change, not to moving them first", () => {
    const html = renderActions(
      finishedPlayer,
      fee({ nextMonthFeePaise: 450_000 }),
      bookedChange("change"),
    )

    expect(nextMonthLine(html)).toBe("₹4,500")
    expect(html).toContain("Their fee from December 2026 is set in the scheduled change.")
    expect(html).not.toContain("Move them to a schedule first")
    expect(html).not.toContain(">Change fee<")
    expect(html).toContain(">Edit scheduled change<")
  })

  it("asks nothing more about the fee once their training's end is booked", () => {
    const html = renderActions(
      finishedPlayer,
      fee({ nextMonthNoFee: "term-finished" }),
      bookedChange("end"),
    )

    expect(html).toContain("Training ends after November 2026")
    expect(html).not.toContain("Move them to a schedule first")
    expect(html).not.toContain("is set in the scheduled change")
    expect(html).not.toContain(">Change fee<")
  })

  it("says a player on no schedule gets no fee next month", () => {
    const resting = player("resting", { activeSessionIds: [], status: "paused" })
    const html = renderActions(resting, fee({ nextMonthNoFee: "no-schedule" }))

    expect(nextMonthLine(html)).toBe("No fee: not on a schedule")
    expect(html).not.toContain(">Change fee<")
  })

  it("leaves a running player's fee and Change fee as they were", () => {
    const html = renderActions(player("running", { activeSessionIds: ["season"] }), fee())

    expect(nextMonthLine(html)).toBe("₹4,000")
    expect(html).toContain(">Change fee<")
    expect(html).not.toContain("No fee:")
    expect(html).not.toContain("Move them to a schedule first")
  })
})

describe("Schedules & rosters", () => {
  beforeEach(() => {
    portal.players = [finishedPlayer, player("running", { activeSessionIds: ["season"] })]
    portal.sessionAssignments = [assignment("finished", "autumn"), assignment("running", "season")]
    portal.sessionSeries = [
      series("autumn", { endsOn: "2026-10-31" }),
      series("season"),
      series("ended", { endsOn: "2026-09-30", status: "ended" }),
    ]
  })

  it("dates every schedule and moves a finished one to its own group below", () => {
    const html = renderToStaticMarkup(<SessionSchedules today={today} />)

    expect(html).toContain("1 Jul 2026 – 31 Mar 2027")
    expect(html).toContain("Term finished · 1 Jul 2026 – 31 Oct 2026")
    expect(html).toContain("1 still on it")
    expect(html).toContain(">Finished<")
    expect(html).toContain("1 schedule · 1 player still on it")
    // Running schedules come first; the ended one is not listed at all.
    expect(html.indexOf("1 Jul 2026 – 31 Mar 2027")).toBeLessThan(html.indexOf(">Finished<"))
    expect(html).not.toContain("30 Sept 2026")
    expect(html).not.toContain("30 Sep 2026")
  })

  it("counts a player also on a running schedule as still on it, not as one to move", () => {
    // Bala holds a place on the finished schedule and on a running one, so
    // Members calls him active and the dashboard's to-do leaves him out.
    portal.players = [...portal.players, player("mixed", { activeSessionIds: ["autumn", "season"] })]
    portal.sessionAssignments = [
      ...portal.sessionAssignments,
      assignment("mixed", "autumn"),
      assignment("mixed", "season"),
    ]
    const html = renderToStaticMarkup(<SessionSchedules today={today} />)

    expect(html).toContain("2 still on it")
    expect(html).toContain("1 schedule · 2 players still on it")
    expect(html).not.toContain("to move")
  })

  it("says how to move the players on and keeps End schedule on a finished schedule", () => {
    const line = "Term finished on 31 October 2026. Move each player on in <a href=\"/coach/members?status=finished&amp;role=players\">Members</a>, or press End schedule."
    const collapsed = renderToStaticMarkup(<SessionSchedules today={today} />)
    expect(collapsed).toContain(line)
    expect(collapsed.split(line)).toHaveLength(2)

    const expanded = renderToStaticMarkup(<SessionSchedules initialSeriesId="autumn" today={today} />)
    expect(expanded).toContain(line)
    expect(expanded).toContain("End schedule")
  })

  it("does not tell a term-finished player they are on one schedule", () => {
    const html = renderToStaticMarkup(<SessionSchedules initialPlayerId="finished" today={today} />)

    expect(html).toContain("Term finished on 31 October 2026.")
    expect(html).not.toContain("On one schedule")
  })
})
