import { describe, expect, it } from "vitest"

import {
  memberDirectoryHref,
  memberDirectorySearch,
  parseMemberDirectoryCriteria,
} from "@/components/coach/members/member-directory-query"
import {
  parsePlayerAttendanceNavigation,
  playerAttendanceSearch,
  shiftPlayerAttendanceMonth,
} from "@/components/dashboard/player-attendance-query"
import { NOT_A_BATCH, NOT_A_PROGRAMME } from "./support/invalid-domain-values"

describe("Member Directory URL state", () => {
  it("parses supported criteria and rejects unsupported values", () => {
    expect(parseMemberDirectoryCriteria(new URLSearchParams(
      "query=Aarav&level=Intermediate&batch=Weekend&status=active",
    ))).toEqual({
      query: "Aarav",
      level: "Intermediate",
      batch: "Weekend",
      role: "everyone",
      status: "active",
    })

    expect(parseMemberDirectoryCriteria(new URLSearchParams(
      `query=%20%20&level=${encodeURIComponent(NOT_A_PROGRAMME)}`
      + `&batch=${encodeURIComponent(NOT_A_BATCH)}&status=archived`,
    ))).toEqual({
      query: "",
      level: "All levels",
      batch: "All batches",
      role: "everyone",
      status: "all",
    })
  })

  it("carries the role filter, and falls back to everyone on an unknown role", () => {
    expect(parseMemberDirectoryCriteria(new URLSearchParams("role=staff")).role).toBe("staff")
    expect(parseMemberDirectoryCriteria(new URLSearchParams("role=players")).role).toBe("players")
    expect(parseMemberDirectoryCriteria(new URLSearchParams("role=coaches")).role).toBe("everyone")

    // "everyone" is the default, so it stays out of the URL the way the other
    // three all-values do; anything else has to survive a round trip.
    const everyone = parseMemberDirectoryCriteria(new URLSearchParams(""))
    expect(memberDirectorySearch("", everyone)).toBe("")
    const staffOnly = parseMemberDirectoryCriteria(new URLSearchParams("role=staff"))
    expect(memberDirectorySearch("", staffOnly)).toBe("role=staff")
  })

  it("canonicalizes criteria without removing unrelated route state", () => {
    const criteria = parseMemberDirectoryCriteria(new URLSearchParams(
      "query=Aarav&level=Intermediate&batch=Weekend&status=active",
    ))
    const search = memberDirectorySearch("from=dashboard&level=invalid", criteria)

    expect(search).toBe(
      "from=dashboard&query=Aarav&level=Intermediate&batch=Weekend&status=active",
    )
    expect(memberDirectoryHref("/coach/members", search)).toBe(
      "/coach/members?from=dashboard&query=Aarav&level=Intermediate&batch=Weekend&status=active",
    )
  })

  it("preserves meaningful spaces while a multi-word search is being typed", () => {
    const criteria = parseMemberDirectoryCriteria(new URLSearchParams("query=Aarav%20"))

    expect(criteria.query).toBe("Aarav ")
    expect(memberDirectorySearch("", criteria)).toBe("query=Aarav+")
    expect(parseMemberDirectoryCriteria(new URLSearchParams("query=%20%20")).query).toBe("")
  })

  it("represents each filter history entry independently for Back restoration", () => {
    const initial = parseMemberDirectoryCriteria(new URLSearchParams())
    const levelSearch = memberDirectorySearch("", {
      ...initial,
      level: "Advanced",
    })
    const batchSearch = memberDirectorySearch(levelSearch, {
      ...parseMemberDirectoryCriteria(new URLSearchParams(levelSearch)),
      batch: "Weekend",
    })

    expect(parseMemberDirectoryCriteria(new URLSearchParams(batchSearch))).toMatchObject({
      level: "Advanced",
      batch: "Weekend",
    })
    expect(parseMemberDirectoryCriteria(new URLSearchParams(levelSearch))).toMatchObject({
      level: "Advanced",
      batch: "All batches",
    })
    expect(parseMemberDirectoryCriteria(new URLSearchParams())).toEqual(initial)
  })
})

describe("Player attendance URL state", () => {
  const years = [2025, 2026, 2027]
  const currentMonth = 8

  it("restores an expanded calendar and selected supported year and month", () => {
    expect(parsePlayerAttendanceNavigation(
      new URLSearchParams("attendance=register&year=2025&month=07"),
      years,
      2026,
      currentMonth,
    )).toEqual({ isOpen: true, activeYear: 2025, activeMonth: 7 })
  })

  it("canonicalizes invalid state to the closed current-month default", () => {
    const parsed = parsePlayerAttendanceNavigation(
      new URLSearchParams("attendance=open&year=1999&month=13"),
      years,
      2026,
      currentMonth,
    )

    expect(parsed).toEqual({
      isOpen: false,
      activeYear: 2026,
      activeMonth: currentMonth,
    })
    expect(playerAttendanceSearch(
      "attendance=open&year=1999&month=13&source=dashboard",
      parsed,
      2026,
      currentMonth,
    )).toBe("source=dashboard")
  })

  it("keeps open, month/year changes and close entries independently restorable", () => {
    const opened = playerAttendanceSearch("", {
      isOpen: true,
      activeYear: 2026,
      activeMonth: currentMonth,
    }, 2026, currentMonth)
    const changedMonth = playerAttendanceSearch(opened, {
      isOpen: true,
      activeYear: 2026,
      activeMonth: 7,
    }, 2026, currentMonth)
    const changedYear = playerAttendanceSearch(opened, {
      isOpen: true,
      activeYear: 2025,
      activeMonth: 7,
    }, 2026, currentMonth)
    const closed = playerAttendanceSearch(changedYear, {
      isOpen: false,
      activeYear: 2025,
      activeMonth: 7,
    }, 2026, currentMonth)

    expect(opened).toBe("attendance=register")
    expect(changedMonth).toBe("attendance=register&month=07")
    expect(changedYear).toBe("attendance=register&year=2025&month=07")
    expect(closed).toBe("year=2025&month=07")
    expect(parsePlayerAttendanceNavigation(
      new URLSearchParams(changedYear),
      years,
      2026,
      currentMonth,
    )).toEqual({ isOpen: true, activeYear: 2025, activeMonth: 7 })
  })

  it("moves across year boundaries without leaving the loaded record", () => {
    expect(shiftPlayerAttendanceMonth({
      isOpen: true,
      activeYear: 2026,
      activeMonth: 12,
    }, 1, years)).toEqual({
      isOpen: true,
      activeYear: 2027,
      activeMonth: 1,
    })
    expect(shiftPlayerAttendanceMonth({
      isOpen: true,
      activeYear: 2025,
      activeMonth: 1,
    }, -1, years)).toEqual({
      isOpen: true,
      activeYear: 2025,
      activeMonth: 1,
    })
  })
})
