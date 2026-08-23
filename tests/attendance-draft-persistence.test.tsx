import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ATTENDANCE_DRAFT_LIFETIME_MS,
  attendanceDraftStorage,
  discardStaffAttendanceDraft,
  parseAttendanceDraft,
  persistPlayerAttendanceDraft,
  persistStaffAttendanceDraft,
  playerAttendanceDraftKey,
  pruneExpiredAttendanceDrafts,
  readPlayerAttendanceDraft,
  readStaffAttendanceDraft,
  restoredAttendanceDraftNotice,
  staffAttendanceDraftKey,
} from "@/lib/client/attendance-draft-storage"
import type { SessionAttendanceChange } from "@/lib/sessions/types"

const markedAt = Date.parse("2026-08-21T13:00:00.000Z")

const playerMarks: SessionAttendanceChange[] = [
  { choice: "present", expectedChoice: "cleared", occurrenceId: "occurrence-1", playerId: "player-1" },
  { choice: "absent", expectedChoice: "present", occurrenceId: "occurrence-1", playerId: "player-2" },
]

function fakeStorage(
  seed: Record<string, string> = {},
  failWhile?: (entries: Map<string, string>) => boolean,
) {
  const entries = new Map(Object.entries(seed))
  const reads: string[] = []
  let writeAttempts = 0

  const storage: Storage = {
    get length() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
    getItem(key) {
      reads.push(key)
      return entries.get(key) ?? null
    },
    key(index) {
      return [...entries.keys()][index] ?? null
    },
    removeItem(key) {
      entries.delete(key)
    },
    setItem(key, value) {
      writeAttempts += 1
      if (failWhile?.(entries)) {
        const quota = new Error("The quota has been exceeded")
        quota.name = "QuotaExceededError"
        throw quota
      }
      entries.set(key, value)
    },
  }

  return { entries, reads, storage, writeAttempts: () => writeAttempts }
}

describe("attendance draft storage keys", () => {
  it("pins a player draft to its occurrence and a staff draft to its date", () => {
    expect(playerAttendanceDraftKey("occurrence-1"))
      .toBe("smba-attendance-draft-v1:occurrence:occurrence-1")
    expect(staffAttendanceDraftKey("2026-08-21"))
      .toBe("smba-attendance-draft-v1:staff-date:2026-08-21")
  })

  it("round-trips a player register and re-attaches its occurrence", () => {
    const { storage } = fakeStorage()

    persistPlayerAttendanceDraft("occurrence-1", playerMarks, { now: markedAt, storage })

    expect(readPlayerAttendanceDraft("occurrence-1", { now: markedAt, storage }))
      .toEqual(playerMarks)
  })

  it("round-trips a staff roll call and re-attaches its date", () => {
    const { storage } = fakeStorage()
    const drafts = [
      { choice: "present" as const, coachAccountId: "coach-1", dateKey: "2026-08-21", expectedChoice: "cleared" as const },
    ]

    persistStaffAttendanceDraft("2026-08-21", drafts, { now: markedAt, storage })

    expect(readStaffAttendanceDraft("2026-08-21", { now: markedAt, storage })).toEqual(drafts)
  })

  it("never surfaces a draft under another occurrence or date", () => {
    const { storage } = fakeStorage()

    persistPlayerAttendanceDraft("occurrence-1", playerMarks, { now: markedAt, storage })
    persistStaffAttendanceDraft("2026-08-21", [
      { choice: "absent", coachAccountId: "coach-1", dateKey: "2026-08-21", expectedChoice: "cleared" },
    ], { now: markedAt, storage })

    expect(readPlayerAttendanceDraft("occurrence-2", { now: markedAt, storage })).toEqual([])
    expect(readStaffAttendanceDraft("2026-08-22", { now: markedAt, storage })).toEqual([])
  })

  it("discards a record whose stored context disagrees with its key", () => {
    const key = staffAttendanceDraftKey("2026-08-22")
    const { entries, storage } = fakeStorage({
      [key]: JSON.stringify({
        context: "2026-08-21",
        marks: [{ choice: "present", expected: "cleared", subject: "coach-1" }],
        savedAt: markedAt,
      }),
    })

    expect(readStaffAttendanceDraft("2026-08-22", { now: markedAt, storage })).toEqual([])
    expect(entries.has(key)).toBe(false)
  })
})

describe("attendance draft staleness", () => {
  it("keeps a draft inside its lifetime", () => {
    const { storage } = fakeStorage()

    persistPlayerAttendanceDraft("occurrence-1", playerMarks, { now: markedAt, storage })

    expect(readPlayerAttendanceDraft("occurrence-1", {
      now: markedAt + ATTENDANCE_DRAFT_LIFETIME_MS - 1_000,
      storage,
    })).toEqual(playerMarks)
  })

  it("drops and removes a draft older than its lifetime", () => {
    const { entries, storage } = fakeStorage()

    persistPlayerAttendanceDraft("occurrence-1", playerMarks, { now: markedAt, storage })

    expect(readPlayerAttendanceDraft("occurrence-1", {
      now: markedAt + ATTENDANCE_DRAFT_LIFETIME_MS + 1,
      storage,
    })).toEqual([])
    expect(entries.size).toBe(0)
  })

  it("drops a draft stamped in the future by a device whose clock moved back", () => {
    const { storage } = fakeStorage()

    persistPlayerAttendanceDraft("occurrence-1", playerMarks, {
      now: markedAt + ATTENDANCE_DRAFT_LIFETIME_MS * 2,
      storage,
    })

    expect(readPlayerAttendanceDraft("occurrence-1", { now: markedAt, storage })).toEqual([])
  })

  it("prunes expired drafts and leaves live ones and unrelated keys alone", () => {
    const { entries, storage } = fakeStorage({ "smba-coach-report-resume-v1": "{}" })

    persistPlayerAttendanceDraft("occurrence-old", playerMarks, {
      now: markedAt - ATTENDANCE_DRAFT_LIFETIME_MS - 1,
      storage,
    })
    persistPlayerAttendanceDraft("occurrence-1", playerMarks, { now: markedAt, storage })

    pruneExpiredAttendanceDrafts(storage, markedAt)

    expect([...entries.keys()].sort()).toEqual([
      "smba-attendance-draft-v1:occurrence:occurrence-1",
      "smba-coach-report-resume-v1",
    ])
  })
})

describe("attendance draft payload validation", () => {
  it("rejects anything it did not write", () => {
    expect(parseAttendanceDraft(null)).toBeNull()
    expect(parseAttendanceDraft("not-json")).toBeNull()
    expect(parseAttendanceDraft(JSON.stringify({ context: "occurrence-1" }))).toBeNull()
    expect(parseAttendanceDraft(JSON.stringify({
      context: "occurrence-1",
      marks: [{ choice: "maybe", expected: "cleared", subject: "player-1" }],
      savedAt: markedAt,
    }))).toBeNull()
    expect(parseAttendanceDraft(JSON.stringify({
      context: "occurrence-1",
      marks: [{ choice: "present", expected: "cleared" }],
      savedAt: markedAt,
    }))).toBeNull()
    expect(parseAttendanceDraft(JSON.stringify({
      context: "occurrence-1",
      marks: [{ choice: "present", expected: "cleared", subject: "player-1" }],
      savedAt: "recently",
    }))).toBeNull()
  })

  it("removes a stored register it can no longer read", () => {
    const key = playerAttendanceDraftKey("occurrence-1")
    const { entries, storage } = fakeStorage({ [key]: "{ truncated" })

    expect(readPlayerAttendanceDraft("occurrence-1", { now: markedAt, storage })).toEqual([])
    expect(entries.has(key)).toBe(false)
  })

  it("clears the stored register when the last mark is undone", () => {
    const { entries, storage } = fakeStorage()

    persistPlayerAttendanceDraft("occurrence-1", playerMarks, { now: markedAt, storage })
    persistPlayerAttendanceDraft("occurrence-1", [], { now: markedAt, storage })

    expect(entries.size).toBe(0)
  })
})

describe("attendance draft storage failure modes", () => {
  it("resolves no storage when there is no window", () => {
    expect(typeof window).toBe("undefined")
    expect(attendanceDraftStorage()).toBeNull()
  })

  it("resolves no storage when the browser refuses the property", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("The operation is insecure")
      },
    })

    expect(attendanceDraftStorage()).toBeNull()
    vi.unstubAllGlobals()
  })

  it("keeps the register working when storage is absent", () => {
    expect(() => persistPlayerAttendanceDraft("occurrence-1", playerMarks, { storage: null }))
      .not.toThrow()
    expect(() => discardStaffAttendanceDraft("2026-08-21", { storage: null })).not.toThrow()
    expect(readPlayerAttendanceDraft("occurrence-1", { storage: null })).toEqual([])
  })

  it("keeps the register working when every write is refused", () => {
    const { storage } = fakeStorage({}, () => true)

    expect(() => persistPlayerAttendanceDraft("occurrence-1", playerMarks, {
      now: markedAt,
      storage,
    })).not.toThrow()
    expect(readPlayerAttendanceDraft("occurrence-1", { now: markedAt, storage })).toEqual([])
  })

  it("clears expired drafts and retries once when the quota is exhausted", () => {
    const stale = playerAttendanceDraftKey("occurrence-old")
    const { entries, storage, writeAttempts } = fakeStorage(
      {
        [stale]: JSON.stringify({
          context: "occurrence-old",
          marks: [{ choice: "present", expected: "cleared", subject: "player-9" }],
          savedAt: markedAt - ATTENDANCE_DRAFT_LIFETIME_MS - 1,
        }),
      },
      (current) => current.has(stale),
    )

    persistPlayerAttendanceDraft("occurrence-1", playerMarks, { now: markedAt, storage })

    expect(writeAttempts()).toBe(2)
    expect(entries.has(stale)).toBe(false)
    expect(readPlayerAttendanceDraft("occurrence-1", { now: markedAt, storage }))
      .toEqual(playerMarks)
  })

  it("returns no draft when a read throws mid-flight", () => {
    const key = playerAttendanceDraftKey("occurrence-1")
    const { storage } = fakeStorage({ [key]: "{}" })
    const throwing: Storage = {
      ...storage,
      length: 0,
      getItem() {
        throw new Error("The operation is insecure")
      },
    }

    expect(readPlayerAttendanceDraft("occurrence-1", { now: markedAt, storage: throwing }))
      .toEqual([])
  })
})

describe("restored attendance draft notice", () => {
  it("names the marks as unsaved and the button that records them", () => {
    expect(restoredAttendanceDraftNotice(1, "save attendance")).toBe(
      "1 unsaved change restored from an earlier visit."
      + " Nothing is recorded until you save attendance",
    )
    expect(restoredAttendanceDraftNotice(3, "save staff attendance")).toBe(
      "3 unsaved changes restored from an earlier visit."
      + " Nothing is recorded until you save staff attendance",
    )
  })
})

// The suite has no DOM, so a restored register cannot be observed in the markup:
// the restore runs from a mount effect, and `renderToStaticMarkup` renders once.
// What is verifiable, and what the defect turned on, is that each register reads
// the draft belonging to the selection it is showing — and not another date's.
const { mountEffects, recorderFixture } = vi.hoisted(() => ({
  mountEffects: [] as Array<() => void>,
  recorderFixture: {
    occurrence: {
      durationMinutes: 90,
      eligibilityDate: "2026-08-21",
      id: "occurrence-1",
      occurrenceDate: "2026-08-21",
      replacementForOccurrenceId: null,
      seriesId: "series-1",
      startsAt: "2026-08-21T11:30:00.000Z",
      status: "scheduled",
      venue: "Court 1",
    },
    series: {
      batch: "Weekday",
      endsOn: null,
      id: "series-1",
      programme: "Beginner",
      slots: [],
      startsOn: "2026-08-01",
      status: "active",
      title: "Beginner Weekday",
      venue: "Court 1",
    },
  },
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    useEffect: (effect: () => void) => {
      mountEffects.push(effect)
    },
  }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock("@/app/coach/actions", () => ({
  saveStaffAttendanceAction: vi.fn(),
}))

vi.mock("@/components/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => ({
    confirmDiscard: vi.fn(() => true),
    confirmNavigation: vi.fn(() => true),
    navigateAfterCommit: (navigate: () => void) => navigate(),
  }),
}))

vi.mock("@/components/coach/coach-portal-provider", () => ({
  useAttendancePortal: () => ({
    attendanceAdjustments: [],
    attendanceRecords: {},
    saveAttendanceRegister: vi.fn(),
  }),
  useMemberPortal: () => ({ players: [] }),
  useSessionPortal: () => ({
    sessionAssignments: [],
    sessionOccurrences: [recorderFixture.occurrence],
    sessionSeries: [recorderFixture.series],
  }),
}))

const { PlayerAttendanceRecorder } = await import(
  "@/components/coach/attendance/player-attendance-recorder"
)
const { StaffRollCall } = await import("@/components/coach/attendance/staff-roll-call")

/**
 * Both registers defer the read to a timer, as the report resume hint does, so
 * the stub collects timers and the test runs them where a browser would.
 */
function stubBrowser(storage: Storage) {
  const timers: Array<() => void> = []

  vi.stubGlobal("window", {
    clearInterval: () => {},
    clearTimeout: () => {},
    localStorage: storage,
    setInterval: () => 1,
    setTimeout: (handler: () => void) => {
      timers.push(handler)
      return timers.length
    },
  })

  return {
    mount(element: React.ReactElement) {
      renderToStaticMarkup(element)
      for (const effect of mountEffects.splice(0)) effect()
      while (timers.length) timers.shift()?.()
    },
  }
}

describe("attendance registers restore their own drafts", () => {
  afterEach(() => {
    mountEffects.length = 0
    vi.unstubAllGlobals()
  })

  it("reads the player draft for the selected occurrence on mount", () => {
    const { reads, storage } = fakeStorage()

    stubBrowser(storage).mount(
      <PlayerAttendanceRecorder
        initialDate="2026-08-21"
        initialFromCalendar={false}
        initialOccurrenceId="occurrence-1"
        initialReferenceInstant={Date.parse("2026-08-21T12:00:00.000Z")}
      />,
    )

    expect(reads).toContain("smba-attendance-draft-v1:occurrence:occurrence-1")
  })

  it("reads the staff draft for the selected date rather than today", () => {
    const { reads, storage } = fakeStorage()

    stubBrowser(storage).mount(
      <StaffRollCall
        initialDate="2026-08-21"
        initialRecords={[]}
        juniorCoaches={[{
          accountId: "coach-1",
          fullName: "Ishaan Rao",
          initials: "IR",
          joinedOn: "2026-01-05",
        }]}
        referenceDate="2026-08-23"
      />,
    )

    expect(reads).toContain("smba-attendance-draft-v1:staff-date:2026-08-21")
    expect(reads).not.toContain("smba-attendance-draft-v1:staff-date:2026-08-23")
  })
})
