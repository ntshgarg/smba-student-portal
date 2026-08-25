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

  it("names the marks whose stored value moved while the draft waited", () => {
    expect(restoredAttendanceDraftNotice(2, "save attendance", 1)).toBe(
      "2 unsaved changes restored from an earlier visit."
      + " 1 was marked differently elsewhere since."
      + " Nothing is recorded until you save attendance",
    )
    expect(restoredAttendanceDraftNotice(2, "save attendance", 2)).toBe(
      "2 unsaved changes restored from an earlier visit."
      + " 2 were marked differently elsewhere since."
      + " Nothing is recorded until you save attendance",
    )
  })
})

// The suite has no DOM, so a restored register cannot be observed in the markup:
// the restore runs from a mount effect, and `renderToStaticMarkup` renders once.
// What a register does with a restored draft is two state updates — the marks it
// puts back on screen and the notice it shows above them — so the mocked
// `useState` records every update and `mount` below hands back the ones the
// restore made. That is the second render this suite cannot do.
const { mountEffects, recorderFixture, stateUpdates } = vi.hoisted(() => ({
  mountEffects: [] as Array<() => void>,
  stateUpdates: [] as unknown[],
  recorderFixture: {
    // The saved register the recorder hydrates with, which a restored draft is
    // rebased onto. Mutable so a test can put the occurrence's cells where the
    // days between marking and restoring would have left them.
    attendanceRecords: {} as Record<string, Record<string, "absent" | "present">>,
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
    // The real setter is still called, so nothing about the component changes;
    // on the server it is a no-op after the render that created it, which is why
    // the recorded value is the only way back to what the restore decided.
    useState: (initial: unknown) => {
      const [value, set] = actual.useState(initial)
      return [value, (next: unknown) => {
        stateUpdates.push(next)
        set(next)
      }]
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
    attendanceRecords: recorderFixture.attendanceRecords,
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
    /**
     * Each register holds exactly one array-valued state — the marks it is
     * showing — and one feedback state shaped `{ message, tone }`, so the two
     * updates a restore makes are identifiable by shape and this stays
     * independent of hook order.
     */
    mount(element: React.ReactElement) {
      stateUpdates.length = 0
      renderToStaticMarkup(element)
      for (const effect of mountEffects.splice(0)) effect()
      while (timers.length) timers.shift()?.()

      const marks = stateUpdates.find((update) => Array.isArray(update))
      const feedback = stateUpdates.find((update) => (
        !!update && typeof update === "object" && "message" in update
      )) as { message: string } | undefined

      return {
        marks: (marks ?? []) as Array<{ choice: string; expectedChoice: string }>,
        notice: feedback?.message,
      }
    },
  }
}

/**
 * The service's write guard, replayed over what a register would send after a
 * restore: `lib/sessions/service.ts` skips a mark the stored value already
 * agrees with, writes one whose expectation matches that value, and raises
 * CONFLICT for everything else. `lib/coach/staff-attendance.ts` repeats it.
 */
function serverVerdict(
  change: { choice: string; expectedChoice: string },
  currentChoice: string,
) {
  if (currentChoice === change.choice) return "skipped"
  return currentChoice === change.expectedChoice ? "written" : "conflict"
}

describe("attendance registers restore their own drafts", () => {
  afterEach(() => {
    mountEffects.length = 0
    recorderFixture.attendanceRecords = {}
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

  // Four days is well inside the seven-day lifetime and long enough for the
  // register to have been written elsewhere — the same head coach finishing it
  // on a laptop. Measured against the real clock because both registers read
  // their draft without options, so `now` defaults to `Date.now()`.
  const markedFourDaysAgo = () => Date.now() - 4 * 24 * 60 * 60 * 1_000

  // A restore is watched through what the register does with it rather than
  // through storage, because the restore deliberately leaves the stored draft as
  // the coach marked it: the stored expectation is what "marked differently
  // elsewhere" is counted from, and both readers rebase, so correcting storage
  // would buy nothing and cost the warning.
  function seedMovedPlayerDraft(storage: Storage) {
    persistPlayerAttendanceDraft("occurrence-1", [
      { choice: "absent", expectedChoice: "cleared", occurrenceId: "occurrence-1", playerId: "player-1" },
      { choice: "present", expectedChoice: "cleared", occurrenceId: "occurrence-1", playerId: "player-2" },
    ], { now: markedFourDaysAgo(), storage })
    // Both cells were written elsewhere while the draft waited.
    recorderFixture.attendanceRecords = {
      "occurrence-1": { "player-1": "present", "player-2": "present" },
    }
  }

  function mountRecorder(storage: Storage) {
    return stubBrowser(storage).mount(
      <PlayerAttendanceRecorder
        initialDate="2026-08-21"
        initialFromCalendar={false}
        initialOccurrenceId="occurrence-1"
        initialReferenceInstant={Date.parse("2026-08-21T12:00:00.000Z")}
      />,
    )
  }

  function seedMovedStaffDraft(storage: Storage) {
    persistStaffAttendanceDraft("2026-08-21", [
      { choice: "absent", coachAccountId: "coach-1", dateKey: "2026-08-21", expectedChoice: "cleared" },
    ], { now: markedFourDaysAgo(), storage })
  }

  function mountRollCall(storage: Storage) {
    return stubBrowser(storage).mount(
      <StaffRollCall
        initialDate="2026-08-21"
        initialRecords={[{ choice: "present", coachAccountId: "coach-1" }]}
        juniorCoaches={[{
          accountId: "coach-1",
          fullName: "Ishaan Rao",
          initials: "IR",
          joinedOn: "2026-01-05",
        }]}
        referenceDate="2026-08-23"
      />,
    )
  }

  const movedPlayerNotice = "1 unsaved change restored from an earlier visit."
    + " 1 was marked differently elsewhere since."
    + " Nothing is recorded until you save attendance"

  const movedStaffNotice = "1 unsaved change restored from an earlier visit."
    + " 1 was marked differently elsewhere since."
    + " Nothing is recorded until you save staff attendance"

  it("restores a player draft the register it comes back to can still save", () => {
    const { storage } = fakeStorage()
    seedMovedPlayerDraft(storage)

    const restore = mountRecorder(storage)

    // player-2 is already present on the register, so that mark is not unsaved
    // work and is dropped; player-1 keeps the coach's absence and now expects
    // what is stored, which is the difference between a write and a CONFLICT the
    // coach cannot clear.
    expect(restore.marks).toEqual([
      { choice: "absent", expectedChoice: "present", occurrenceId: "occurrence-1", playerId: "player-1" },
    ])
    expect(restore.marks.map((change) => serverVerdict(change, "present"))).toEqual(["written"])
    expect(restore.notice).toBe(movedPlayerNotice)
  })

  // `chooseOccurrence` navigates and the page keys the recorder on the selection
  // (`app/coach/attendance/players/record/page.tsx`), so the tap that restores a
  // draft also remounts the register that restored it — and the refresh the
  // CONFLICT copy asks for does the same. The second restore is the one the
  // coach reads, so it has to carry the same warning: a draft whose stored
  // expectation had been rewritten comes back looking like it was marked against
  // the register in front of it, one tap from overwriting a colleague's fresher
  // mark unwarned.
  it("still warns about the moved marks when the register is remounted", () => {
    const { storage } = fakeStorage()
    seedMovedPlayerDraft(storage)

    mountRecorder(storage)
    const reopened = mountRecorder(storage)

    expect(reopened.marks).toEqual([
      { choice: "absent", expectedChoice: "present", occurrenceId: "occurrence-1", playerId: "player-1" },
    ])
    expect(reopened.notice).toBe(movedPlayerNotice)
  })

  it("restores a staff draft the day it comes back to can still save", () => {
    const { storage } = fakeStorage()
    seedMovedStaffDraft(storage)

    const restore = mountRollCall(storage)

    expect(restore.marks).toEqual([
      { choice: "absent", coachAccountId: "coach-1", dateKey: "2026-08-21", expectedChoice: "present" },
    ])
    expect(restore.marks.map((change) => serverVerdict(change, "present"))).toEqual(["written"])
    expect(restore.notice).toBe(movedStaffNotice)
  })

  it("still warns about the moved staff marks when the roll call is remounted", () => {
    const { storage } = fakeStorage()
    seedMovedStaffDraft(storage)

    mountRollCall(storage)
    const reopened = mountRollCall(storage)

    expect(reopened.marks).toEqual([
      { choice: "absent", coachAccountId: "coach-1", dateKey: "2026-08-21", expectedChoice: "present" },
    ])
    expect(reopened.notice).toBe(movedStaffNotice)
  })
})
