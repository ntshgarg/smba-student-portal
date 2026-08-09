import { describe, expect, it } from "vitest"

import {
  memberDirectoryHref,
  memberDirectorySearch,
  parseMemberDirectoryCriteria,
} from "@/components/coach/members/member-directory-query"
import {
  parsePlayerAttendanceNavigation,
  playerAttendanceSearch,
} from "@/components/dashboard/player-attendance-query"

describe("Member Directory URL state", () => {
  it("parses supported criteria and rejects unsupported values", () => {
    expect(parseMemberDirectoryCriteria(new URLSearchParams(
      "query=Aarav&level=Intermediate&batch=Weekend&status=active",
    ))).toEqual({
      query: "Aarav",
      level: "Intermediate",
      batch: "Weekend",
      status: "active",
    })

    expect(parseMemberDirectoryCriteria(new URLSearchParams(
      "query=%20%20&level=Elite&batch=Everyday&status=archived",
    ))).toEqual({
      query: "",
      level: "All levels",
      batch: "All batches",
      status: "all",
    })
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

  it("restores an expanded register and selected supported year", () => {
    expect(parsePlayerAttendanceNavigation(
      new URLSearchParams("attendance=register&year=2025"),
      years,
      2026,
    )).toEqual({ isOpen: true, activeYear: 2025 })
  })

  it("canonicalizes invalid state to the closed current-year default", () => {
    const parsed = parsePlayerAttendanceNavigation(
      new URLSearchParams("attendance=open&year=1999"),
      years,
      2026,
    )

    expect(parsed).toEqual({ isOpen: false, activeYear: 2026 })
    expect(playerAttendanceSearch(
      "attendance=open&year=1999&source=dashboard",
      parsed,
      2026,
    )).toBe("source=dashboard")
  })

  it("keeps open, year-change and close entries independently restorable", () => {
    const opened = playerAttendanceSearch("", {
      isOpen: true,
      activeYear: 2026,
    }, 2026)
    const changedYear = playerAttendanceSearch(opened, {
      isOpen: true,
      activeYear: 2025,
    }, 2026)
    const closed = playerAttendanceSearch(changedYear, {
      isOpen: false,
      activeYear: 2025,
    }, 2026)

    expect(opened).toBe("attendance=register")
    expect(changedYear).toBe("attendance=register&year=2025")
    expect(closed).toBe("year=2025")
    expect(parsePlayerAttendanceNavigation(
      new URLSearchParams(changedYear),
      years,
      2026,
    )).toEqual({ isOpen: true, activeYear: 2025 })
  })
})
