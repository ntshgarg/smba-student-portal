import { describe, expect, it } from "vitest"

import {
  isAcademyMember,
  isPlayerTrainingProfile,
  joinPlayerMembers,
  memberInitials,
} from "@/lib/coach/member-utils"
import type { AcademyMember, PlayerTrainingProfile } from "@/lib/coach/types"

const member: AcademyMember = {
  id: "player-one",
  role: "player",
  academyId: "SMBA#0002",
  fullName: "Aarav Kulkarni",
  initials: "AK",
  trainingStartOn: "2025-05-21",
  primaryContact: {
    name: "Shreya Kulkarni",
    relationship: "Parent",
    phone: "+91 00000 00006",
  },
}

const training: PlayerTrainingProfile = {
  memberId: "player-one",
  ageGroup: "Under 13",
  level: "Beginner",
  batch: "Weekday",
  academyPlan: "weekday-3-day",
  activeSessionIds: ["series-one"],
  recordRevision: 0,
  status: "active",
}

describe("coach member utilities", () => {
  it("creates stable initials from normalized member names", () => {
    expect(memberInitials("  Aarav   Kulkarni ")).toBe("AK")
    expect(memberInitials("Meera")).toBe("M")
  })

  it("joins only members with a matching player training profile", () => {
    expect(joinPlayerMembers([member], [training])).toEqual([{ member, training }])
    expect(joinPlayerMembers([member], [])).toEqual([])
  })

  it("rejects malformed member storage records", () => {
    expect(isAcademyMember(member)).toBe(true)
    expect(isAcademyMember({ ...member, primaryContact: null })).toBe(false)
    expect(isPlayerTrainingProfile(training)).toBe(true)
    expect(isPlayerTrainingProfile({ ...training, activeSessionIds: [42] })).toBe(false)
    expect(isPlayerTrainingProfile({ ...training, recordRevision: -1 })).toBe(false)
  })
})
