import { describe, expect, it } from "vitest"

import {
  REPORT_DRAFT_LIFETIME_MS,
  discardReportDraft,
  parseReportDraft,
  persistReportDraft,
  readReportDraft,
  rebaseRestoredReportDraft,
  reportDraftKey,
  restoredReportDraftNotice,
} from "@/lib/client/report-draft-storage"

const writtenAt = Date.parse("2026-08-21T13:00:00.000Z")
const playerId = "player-1"
const month = "2026-07"
const published = "Aarav has trained with good attention this month."
const edited = `${published} Footwork is the next thing to hold.`

/**
 * Mirrors the fake in tests/attendance-draft-persistence.test.tsx. `failWhile`
 * exists so the quota path can be exercised without a real storage backend.
 */
function fakeStorage(
  seed: Record<string, string> = {},
  failWhile?: (entries: Map<string, string>) => boolean,
) {
  const entries = new Map(Object.entries(seed))
  let writeAttempts = 0

  const storage: Storage = {
    get length() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
    getItem(key) {
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

  return { entries, storage, writeAttempts: () => writeAttempts }
}

describe("report draft storage", () => {
  it("pins a draft to one player and one month", () => {
    expect(reportDraftKey(playerId, month)).toBe("smba-report-draft-v1:player-1:2026-07")
  })

  it("round-trips the text and the baseline it was written against", () => {
    const { storage } = fakeStorage()

    persistReportDraft(playerId, month, { baseline: published, text: edited }, {
      now: writtenAt,
      storage,
    })

    expect(readReportDraft(playerId, month, { now: writtenAt, storage })).toEqual({
      baseline: published,
      context: "player-1:2026-07",
      savedAt: writtenAt,
      text: edited,
    })
  })

  it("never surfaces a draft under another player or another month", () => {
    const { storage } = fakeStorage()

    persistReportDraft(playerId, month, { baseline: published, text: edited }, {
      now: writtenAt,
      storage,
    })

    expect(readReportDraft("player-2", month, { now: writtenAt, storage })).toBeNull()
    expect(readReportDraft(playerId, "2026-06", { now: writtenAt, storage })).toBeNull()
  })

  it("discards a record whose stored context disagrees with its key", () => {
    const key = reportDraftKey(playerId, month)
    const { entries, storage } = fakeStorage({
      [key]: JSON.stringify({
        baseline: published,
        context: "player-2:2026-07",
        savedAt: writtenAt,
        text: edited,
      }),
    })

    expect(readReportDraft(playerId, month, { now: writtenAt, storage })).toBeNull()
    expect(entries.has(key)).toBe(false)
  })

  it("stores nothing when the text is back to what is already saved", () => {
    const { entries, storage } = fakeStorage()

    persistReportDraft(playerId, month, { baseline: published, text: edited }, {
      now: writtenAt,
      storage,
    })
    expect(entries.size).toBe(1)

    persistReportDraft(playerId, month, { baseline: published, text: published }, {
      now: writtenAt,
      storage,
    })
    expect(entries.size).toBe(0)
  })

  it("expires a draft in either time direction so a moved clock cannot strand one", () => {
    const { storage } = fakeStorage()
    persistReportDraft(playerId, month, { baseline: published, text: edited }, {
      now: writtenAt,
      storage,
    })

    const justInside = writtenAt + REPORT_DRAFT_LIFETIME_MS
    expect(readReportDraft(playerId, month, { now: justInside, storage })).not.toBeNull()

    expect(readReportDraft(playerId, month, {
      now: writtenAt + REPORT_DRAFT_LIFETIME_MS + 1,
      storage,
    })).toBeNull()
  })

  it("prunes expired drafts on the read path and retries a refused write once", () => {
    const stale = JSON.stringify({
      baseline: "",
      context: "player-9:2026-01",
      savedAt: writtenAt - REPORT_DRAFT_LIFETIME_MS - 1,
      text: "abandoned",
    })
    // Refuses the first write, then accepts once pruning has emptied the store.
    const { entries, storage, writeAttempts } = fakeStorage(
      { [reportDraftKey("player-9", "2026-01")]: stale },
      (current) => current.size > 0,
    )

    persistReportDraft(playerId, month, { baseline: published, text: edited }, {
      now: writtenAt,
      storage,
    })

    expect(writeAttempts()).toBe(2)
    expect(entries.has(reportDraftKey("player-9", "2026-01"))).toBe(false)
    expect(entries.has(reportDraftKey(playerId, month))).toBe(true)
  })

  it("rejects a payload that is not the shape this version writes", () => {
    expect(parseReportDraft(null)).toBeNull()
    expect(parseReportDraft("not json")).toBeNull()
    expect(parseReportDraft(JSON.stringify({ context: "a:b", savedAt: 1, text: "x" }))).toBeNull()
    expect(parseReportDraft(JSON.stringify({ baseline: "", context: "a:b", savedAt: "1", text: "x" })))
      .toBeNull()
    expect(parseReportDraft(JSON.stringify({ baseline: "", context: "", savedAt: 1, text: "x" })))
      .toBeNull()
  })

  it("discards a draft on request", () => {
    const { entries, storage } = fakeStorage()
    persistReportDraft(playerId, month, { baseline: published, text: edited }, {
      now: writtenAt,
      storage,
    })

    discardReportDraft(playerId, month, { storage })

    expect(entries.size).toBe(0)
  })
})

describe("rebasing a restored report draft", () => {
  const draft = {
    baseline: published,
    context: "player-1:2026-07",
    savedAt: writtenAt,
    text: edited,
  }

  it("restores nothing when the draft and the saved report now agree", () => {
    expect(rebaseRestoredReportDraft(draft, edited)).toBeNull()
  })

  it("restores the coach's text when the report has not moved underneath it", () => {
    expect(rebaseRestoredReportDraft(draft, published))
      .toEqual({ changedUnderneath: false, text: edited })
  })

  it("still restores, and says so, when the saved report moved underneath the draft", () => {
    expect(rebaseRestoredReportDraft(draft, "Rewritten on a laptop."))
      .toEqual({ changedUnderneath: true, text: edited })
  })

  it("has nothing to restore without a draft", () => {
    expect(rebaseRestoredReportDraft(null, published)).toBeNull()
  })
})

describe("the restored-draft notice", () => {
  it("names the button the coach has to press", () => {
    expect(restoredReportDraftNotice(false))
      .toBe("Unsaved report text restored from an earlier visit."
        + " Nothing is recorded until you save the draft")
  })

  it("says when the saved report moved, between what is on screen and what to do", () => {
    expect(restoredReportDraftNotice(true))
      .toBe("Unsaved report text restored from an earlier visit."
        + " The saved report has changed since."
        + " Nothing is recorded until you save the draft")
  })
})
