import { describe, expect, it } from "vitest"

import {
  buildFinishedSchedules,
  buildProgrammeGroups,
  buildSessionScheduleIndex,
  scheduleGroupKey,
} from "@/components/coach/calendar/session-schedule-index"
import { playerDashboardState } from "@/components/dashboard/player-dashboard-state"
import { buildMemberDirectoryIndex } from "@/components/coach/members/member-directory-index"
import {
  memberDirectorySearch,
  parseMemberDirectoryCriteria,
  termFinishedMembersHref,
} from "@/components/coach/members/member-directory-query"
import type { PlayerMemberRecord } from "@/lib/coach/types"
import {
  bookedStepMessage,
  formatTermDate,
  monthAfterFinishedTerm,
  placeReachesWindow,
  playerTrainingStatus,
  scheduleIsRunning,
  scheduleTermFinished,
  termFinishedMessage,
  termFinishedOn,
  termFinishedToMove,
  trainingStatusLabel,
} from "@/lib/sessions/term"
import type { SessionAssignment, TrainingSessionSeries } from "@/lib/sessions/types"

/*
 * "Term finished" (head coach, 12 Nov 2026): nothing changes by itself when a
 * schedule's last day passes, so every screen works it out from the open
 * places and the academy's today with one shared rule.
 */

const today = "2026-11-12"
const running = { endsOn: "2027-03-31", status: "active" as const }
const lastDayToday = { endsOn: today, status: "active" as const }
const finishedYesterday = { endsOn: "2026-11-11", status: "active" as const }
const finishedOctober = { endsOn: "2026-10-31", status: "active" as const }
const ended = { endsOn: "2026-10-31", status: "ended" as const }
const openEnded = { endsOn: null, status: "active" as const }

function series(
  id: string,
  overrides: Partial<TrainingSessionSeries> = {},
): TrainingSessionSeries {
  return {
    batch: "Weekday",
    endsOn: "2027-03-31",
    id,
    programme: "Beginner",
    slots: [{ durationMinutes: 60, id: `${id}-slot`, startTime: "06:00", weekday: 1 }],
    startsOn: "2026-04-01",
    status: "active",
    title: id,
    venue: "SMBA Court",
    ...overrides,
  }
}

function place(playerId: string, seriesId: string, effectiveTo: string | null = null): SessionAssignment {
  return {
    effectiveFrom: "2026-04-01",
    effectiveTo,
    id: `${playerId}-${seriesId}`,
    playerId,
    seriesId,
    weekdays: [1],
  }
}

describe("the shared term rule", () => {
  it("keeps a schedule running on its last day and finishes it the day after", () => {
    expect(scheduleIsRunning(lastDayToday, today)).toBe(true)
    expect(scheduleTermFinished(lastDayToday, today)).toBe(false)
    expect(scheduleIsRunning(finishedYesterday, today)).toBe(false)
    expect(scheduleTermFinished(finishedYesterday, today)).toBe(true)
    expect(scheduleIsRunning(openEnded, today)).toBe(true)
    expect(scheduleTermFinished(openEnded, today)).toBe(false)
  })

  it("treats an ended schedule as neither running nor term-finished", () => {
    expect(scheduleIsRunning(ended, today)).toBe(false)
    expect(scheduleTermFinished(ended, today)).toBe(false)
    expect(termFinishedOn([ended], today)).toBeNull()
  })

  it("finishes a player's term only when no open place is still running", () => {
    expect(termFinishedOn([], today)).toBeNull()
    expect(termFinishedOn([lastDayToday], today)).toBeNull()
    expect(termFinishedOn([finishedYesterday], today)).toBe("2026-11-11")
    // Mixed running and finished places: still training, so not finished.
    expect(termFinishedOn([finishedOctober, running], today)).toBeNull()
    expect(termFinishedOn([running, finishedOctober], today)).toBeNull()
    // Several finished places: the latest last day is the term's end.
    expect(termFinishedOn([finishedOctober, finishedYesterday], today)).toBe("2026-11-11")
    expect(termFinishedOn([finishedYesterday, finishedOctober], today)).toBe("2026-11-11")
  })

  it("gives Members a finished status without disturbing active, paused or unassigned", () => {
    expect(playerTrainingStatus({ enrollmentStatus: "active", openPlaces: [finishedOctober], today }))
      .toEqual({ status: "finished", termFinishedOn: "2026-10-31" })
    expect(playerTrainingStatus({ enrollmentStatus: "active", openPlaces: [finishedOctober, running], today }))
      .toEqual({ status: "active", termFinishedOn: null })
    expect(playerTrainingStatus({ enrollmentStatus: "active", openPlaces: [lastDayToday], today }))
      .toEqual({ status: "active", termFinishedOn: null })
    expect(playerTrainingStatus({ enrollmentStatus: "paused", openPlaces: [], today }))
      .toEqual({ status: "paused", termFinishedOn: null })
    expect(playerTrainingStatus({ enrollmentStatus: "unassigned", openPlaces: [], today }))
      .toEqual({ status: "unassigned", termFinishedOn: null })
    // An open place on an ended schedule is not a finished term.
    expect(playerTrainingStatus({ enrollmentStatus: "active", openPlaces: [ended], today }).status)
      .toBe("active")
  })

  it("cuts a place off at its schedule's last day when asking whether it reaches a window", () => {
    const open = { effectiveFrom: "2026-04-01", effectiveTo: null }
    expect(placeReachesWindow(open, { endsOn: "2026-10-31" }, "2027-01-01", "2028-01-01")).toBe(false)
    expect(placeReachesWindow(open, { endsOn: "2026-12-31" }, "2026-12-01", "2027-01-01")).toBe(true)
    expect(placeReachesWindow(open, { endsOn: "2026-11-30" }, "2026-12-01", "2027-01-01")).toBe(false)
    expect(placeReachesWindow(open, { endsOn: null }, "2027-01-01", "2028-01-01")).toBe(true)
    expect(placeReachesWindow(open, undefined, "2027-01-01", "2028-01-01")).toBe(true)
    expect(placeReachesWindow(open, { endsOn: null, startsOn: "2027-02-01" }, "2026-12-01", "2027-01-01"))
      .toBe(false)
    // A closed place ends on its own dates, as before.
    expect(placeReachesWindow({ effectiveFrom: "2026-04-01", effectiveTo: "2027-01-01" }, null, "2027-01-01", "2028-01-01"))
      .toBe(false)
  })

  it("writes the date and the family message in plain words", () => {
    expect(formatTermDate("2026-10-31")).toBe("31 October 2026")
    expect(termFinishedMessage("2026-10-31")).toBe(
      "Your term finished on 31 October 2026. Your next schedule will appear here once your coach confirms it.",
    )
    // Once the move is booked, the family is told when it starts.
    expect(termFinishedMessage("2026-10-31", "2026-12-01")).toBe(
      "Your term finished on 31 October 2026. Your next schedule starts on 1 December 2026.",
    )
    // A booked end of training is not a promise of a new schedule.
    expect(termFinishedMessage("2026-10-31", null, "2026-12-01")).toBe(
      "Your term finished on 31 October 2026. Your training ends on 1 December 2026.",
    )
    expect(bookedStepMessage()).toBeNull()
    expect(bookedStepMessage("2026-12-01")).toBe("Your next schedule starts on 1 December 2026.")
    expect(trainingStatusLabel("finished")).toBe("Term finished")
    expect(trainingStatusLabel("paused")).toBe("paused")
  })
})

describe("Schedules & rosters grouping", () => {
  const runningSeries = series("running")
  const lastDaySeries = series("last-day", { endsOn: today })
  const finishedSeries = series("finished", { endsOn: "2026-10-31", programme: "Intermediate" })
  const endedSeries = series("ended", { endsOn: "2026-10-31", status: "ended" })
  const assignments = [
    place("a", "running"),
    place("b", "finished"),
    place("c", "finished"),
    place("d", "finished", "2026-10-15"),
    place("e", "last-day"),
  ]

  it("keeps finished schedules out of the running groups and lists them on their own", () => {
    const { activeBySeries } = buildSessionScheduleIndex(assignments)
    const groups = buildProgrammeGroups([runningSeries, lastDaySeries, finishedSeries, endedSeries], activeBySeries, today)
    expect(groups).toEqual([{ playerCount: 2, programme: "Beginner", series: [runningSeries, lastDaySeries] }])

    const finishedGroup = buildFinishedSchedules(
      [runningSeries, lastDaySeries, finishedSeries, endedSeries],
      activeBySeries,
      today,
    )
    // Only players whose place is still open count as still on it.
    expect(finishedGroup).toEqual({ playerCount: 2, series: [finishedSeries] })
  })

  it("files a finished schedule under the finished group key", () => {
    expect(scheduleGroupKey(finishedSeries, today)).toBe("finished")
    expect(scheduleGroupKey(lastDaySeries, today)).toBe("Beginner")
    expect(scheduleGroupKey(finishedSeries, "2026-10-31")).toBe("Intermediate")
  })
})

describe("Members directory", () => {
  const player = {
    member: {
      academyId: "SMBA#0002",
      fullName: "Aarav Kulkarni",
      id: "player-one",
      initials: "AK",
      primaryContact: { name: "", phone: "", relationship: "" },
      role: "player",
      trainingStartOn: "2026-04-01",
    },
    training: {
      academyPlan: "weekday-3-day",
      activeSessionIds: ["finished", "running"],
      ageGroup: "Under 13",
      batch: "Weekday",
      level: "Beginner",
      memberId: "player-one",
      recordRevision: 0,
      status: "active",
      termFinishedOn: null,
    },
  } satisfies PlayerMemberRecord

  it("labels a place on a finished schedule in the player's session list", () => {
    const records = [series("finished", { endsOn: "2026-10-31" }), series("running")]
    const assignments = [place("player-one", "finished"), place("player-one", "running")]

    const labels = buildMemberDirectoryIndex([player], assignments, records, today)
      .sessionLabelsByPlayer.get("player-one")
    expect(labels).toHaveLength(2)
    expect(labels?.[0]).toMatch(/ \(term finished 31 October 2026\)$/u)
    expect(labels?.[1]).not.toContain("term finished")

    // Without the academy's today nothing is guessed from the device clock.
    expect(buildMemberDirectoryIndex([player], assignments, records)
      .sessionLabelsByPlayer.get("player-one")?.join(" ")).not.toContain("term finished")
  })

  it("filters to term-finished players from the dashboard link", () => {
    const criteria = parseMemberDirectoryCriteria(new URLSearchParams("status=finished"))
    expect(criteria.status).toBe("finished")
    expect(memberDirectorySearch("", criteria)).toBe("status=finished")
  })

  it("links to the players to move only, in the directory's own query format", () => {
    // Coaches ignore the status filter, so without the role every coach
    // would follow the players to move (and be counted with them).
    expect(termFinishedMembersHref).toBe("/coach/members?status=finished&role=players")
    const criteria = parseMemberDirectoryCriteria(new URL(termFinishedMembersHref, "https://smba.test").searchParams)
    expect(criteria).toMatchObject({ role: "players", status: "finished" })
    expect(`/coach/members?${memberDirectorySearch("", criteria)}`).toBe(termFinishedMembersHref)
  })
})

describe("what is left to do once a term has finished", () => {
  it("leaves a player whose move or end is booked out of the players to move", () => {
    expect(termFinishedToMove("finished", false)).toBe(true)
    expect(termFinishedToMove("finished", true)).toBe(false)
    // Only a finished term is ever "to move".
    expect(termFinishedToMove("active", false)).toBe(false)
    expect(termFinishedToMove("paused", false)).toBe(false)
    expect(termFinishedToMove("unassigned", false)).toBe(false)
  })

  it("gives no fee only for the months between the term's end and a booked move", () => {
    const finished = { feeResumesOn: null, termFinishedOn: "2026-10-31" }
    expect(monthAfterFinishedTerm(finished, "2026-10")).toBe(false)
    expect(monthAfterFinishedTerm(finished, "2026-11")).toBe(true)
    expect(monthAfterFinishedTerm(finished, "2027-02")).toBe(true)

    // A move booked for 1 December is billed from December as usual.
    const booked = { feeResumesOn: "2026-12-01", termFinishedOn: "2026-10-31" }
    expect(monthAfterFinishedTerm(booked, "2026-11")).toBe(true)
    expect(monthAfterFinishedTerm(booked, "2026-12")).toBe(false)
    expect(monthAfterFinishedTerm(booked, "2027-01")).toBe(false)

    expect(monthAfterFinishedTerm({ feeResumesOn: null, termFinishedOn: null }, "2026-12")).toBe(false)
  })
})

describe("the player's dashboard state", () => {
  it("tells a term-finished player so before paused or pending", () => {
    expect(playerDashboardState({ level: "Beginner", status: "active", termFinishedOn: "2026-10-31" }))
      .toBe("term-finished")
    expect(playerDashboardState({ level: "Beginner", status: "active", termFinishedOn: null }))
      .toBe("active")
    expect(playerDashboardState({ level: "Beginner", status: "paused", termFinishedOn: null }))
      .toBe("paused")
    expect(playerDashboardState({ level: "Beginner", status: "unassigned", termFinishedOn: null }))
      .toBe("schedule-pending")
    expect(playerDashboardState({ level: "Assessment pending", status: "unassigned", termFinishedOn: null }))
      .toBe("assessment-pending")
  })
})
