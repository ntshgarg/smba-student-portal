import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  buildProgrammeGroups,
  buildSessionScheduleIndex,
} from "@/components/coach/calendar/session-schedule-index"
import { buildMemberDirectoryIndex } from "@/components/coach/members/member-directory-index"
import type { PlayerMemberRecord } from "@/lib/coach/types"
import type {
  SessionAssignment,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

const player = {
  member: {
    academyId: "SMBA#0002",
    fullName: "Aarav Kulkarni",
    id: "player-one",
    initials: "AK",
    trainingStartOn: "2026-01-02",
    primaryContact: { name: "Ria", phone: "+91 99999 99999", relationship: "Parent" },
    role: "player",
  },
  training: {
    academyPlan: "weekday-3-day",
    activeSessionIds: ["series-one"],
    ageGroup: "Under 13",
    batch: "Weekday",
    level: "Beginner",
    memberId: "player-one",
    recordRevision: 0,
    status: "active",
  },
} satisfies PlayerMemberRecord

const series: TrainingSessionSeries = {
  batch: "Weekday",
  endsOn: null,
  id: "series-one",
  programme: "Beginner",
  slots: [{ durationMinutes: 60, id: "slot-one", startTime: "06:00", weekday: 1 }],
  startsOn: "2026-01-01",
  status: "active",
  title: "Beginner weekday",
  venue: "SMBA Court",
}

const assignments: SessionAssignment[] = [
  {
    effectiveFrom: "2026-01-05",
    effectiveTo: null,
    id: "assignment-one",
    playerId: player.member.id,
    seriesId: series.id,
    weekdays: [1],
  },
]

describe("coach portal composition", () => {
  it("keeps workflow consumers on isolated memoized contexts", () => {
    const source = readFileSync(path.join(
      process.cwd(),
      "components/coach/coach-portal-provider.tsx",
    ), "utf8")

    expect(source).toContain("MemberPortalContext")
    expect(source).toContain("AttendancePortalContext")
    expect(source).toContain("SessionPortalContext")
    expect(source).toContain("ReportPortalContext")
    expect(source).not.toContain("useCoachPortal")
  })

  it("builds member and schedule lookup indexes once from source records", () => {
    const memberIndex = buildMemberDirectoryIndex([player], assignments, [series])
    const scheduleIndex = buildSessionScheduleIndex(assignments)
    const groups = buildProgrammeGroups([series], scheduleIndex.activeBySeries)

    expect(memberIndex.playerById.get(player.member.id)).toBe(player)
    expect(memberIndex.earliestByPlayer.get(player.member.id)).toBe("2026-01-05")
    expect(memberIndex.sessionLabelsByPlayer.get(player.member.id)?.[0]).toContain("Mon")
    expect(scheduleIndex.activeByPlayerSeries.size).toBe(1)
    expect(groups).toEqual([{ playerCount: 1, programme: "Beginner", series: [series] }])
  })
})
