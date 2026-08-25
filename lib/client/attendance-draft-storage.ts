import type { StaffAttendanceChange } from "@/lib/coach/staff-attendance"
import type { SessionAttendanceChange } from "@/lib/sessions/types"

/**
 * Attendance marks live in component state until the coach saves them, so until
 * now a discarded page took every mark with it and left no trace: iOS Safari
 * reclaims a backgrounded tab under memory pressure, and the leave-site dialog
 * is one mis-tap from confirming. These drafts are the only record of marks that
 * were made but never sent.
 *
 * Conventions follow `components/coach/reports/report-resume.ts`: a versioned
 * key, a parser that rejects anything it does not recognise, and callers that
 * treat storage as optional rather than load-bearing.
 */
const ATTENDANCE_DRAFT_KEY_PREFIX = "smba-attendance-draft-v1"

/**
 * The key already pins a draft to one occurrence or one date, so no expiry is
 * needed to keep a draft out of the wrong register. What the key cannot express
 * is age: the same past register is reopened weeks later to correct it, and
 * marks abandoned back then would resurface as "unsaved" long after the coach
 * has forgotten making them. A week covers the operational cycle a register is
 * finished within — same session, that evening, or after the weekend — and
 * bounds how many abandoned drafts a device can accumulate.
 */
export const ATTENDANCE_DRAFT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000

/** Both registers record the same three values. */
type AttendanceDraftChoice = "absent" | "cleared" | "present"

/**
 * `subject` is the player or coach account the mark belongs to, and `expected`
 * is the stored value the mark was made against — the server compares it before
 * writing, so it has to survive with the mark.
 *
 * The occurrence or date is held once on the record rather than repeated per
 * mark. That keeps a full register of thirty players well inside a kilobyte and,
 * more importantly, makes a draft structurally incapable of describing two
 * occurrences at once.
 */
type StoredAttendanceMark = {
  choice: AttendanceDraftChoice
  expected: AttendanceDraftChoice
  subject: string
}

type StoredAttendanceDraft = {
  context: string
  marks: StoredAttendanceMark[]
  savedAt: number
}

type DraftStorageOptions = {
  now?: number
  storage?: Storage | null
}

/**
 * Private browsing and blocked site data can throw on the property access
 * itself, not only on `setItem`, so the resolution is guarded too. A null result
 * means drafts are simply unavailable; every caller degrades to the previous
 * behaviour of holding marks in component state alone.
 */
export function attendanceDraftStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage
  } catch {
    return null
  }
}

export function playerAttendanceDraftKey(occurrenceId: string) {
  return `${ATTENDANCE_DRAFT_KEY_PREFIX}:occurrence:${occurrenceId}`
}

export function staffAttendanceDraftKey(dateKey: string) {
  return `${ATTENDANCE_DRAFT_KEY_PREFIX}:staff-date:${dateKey}`
}

function isDraftChoice(value: unknown): value is AttendanceDraftChoice {
  return value === "absent" || value === "cleared" || value === "present"
}

/**
 * Rejects the whole record rather than salvaging part of it. A mark that fails
 * validation means the payload is not the shape this version writes, and a
 * partial restore would present an incomplete register as a complete one.
 */
export function parseAttendanceDraft(value: string | null): StoredAttendanceDraft | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object") return null

    const candidate = parsed as Record<string, unknown>
    if (typeof candidate.context !== "string" || !candidate.context) return null
    if (typeof candidate.savedAt !== "number" || !Number.isFinite(candidate.savedAt)) return null
    if (!Array.isArray(candidate.marks)) return null

    const marks: StoredAttendanceMark[] = []
    for (const entry of candidate.marks) {
      if (!entry || typeof entry !== "object") return null
      const mark = entry as Record<string, unknown>
      if (typeof mark.subject !== "string" || !mark.subject) return null
      if (!isDraftChoice(mark.choice) || !isDraftChoice(mark.expected)) return null
      marks.push({ choice: mark.choice, expected: mark.expected, subject: mark.subject })
    }

    return { context: candidate.context, marks, savedAt: candidate.savedAt }
  } catch {
    return null
  }
}

/**
 * Compared symmetrically so a device whose clock has moved backwards discards
 * its drafts rather than holding one that can never expire.
 */
function draftIsStale(draft: StoredAttendanceDraft, now: number) {
  return Math.abs(now - draft.savedAt) > ATTENDANCE_DRAFT_LIFETIME_MS
}

/**
 * Bounds what a device accumulates without needing a background job. Called on
 * the read path, so it runs once when a register opens rather than on every
 * mark, and again before a write is retried after quota exhaustion.
 */
export function pruneExpiredAttendanceDrafts(storage: Storage, now: number) {
  try {
    const expired: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key?.startsWith(ATTENDANCE_DRAFT_KEY_PREFIX)) continue
      const draft = parseAttendanceDraft(storage.getItem(key))
      if (!draft || draftIsStale(draft, now)) expired.push(key)
    }
    for (const key of expired) storage.removeItem(key)
  } catch {
    // Storage may disappear mid-iteration or refuse removal; drafts are a
    // convenience and the register keeps working without them.
  }
}

function readDraftMarks(
  key: string,
  context: string,
  { now = Date.now(), storage = attendanceDraftStorage() }: DraftStorageOptions,
) {
  if (!storage) return []

  try {
    pruneExpiredAttendanceDrafts(storage, now)
    const draft = parseAttendanceDraft(storage.getItem(key))
    if (!draft) {
      storage.removeItem(key)
      return []
    }
    // The key alone pins the context; the stored copy is compared as well so a
    // record written under one occurrence or date can never be read back under
    // another, however the key was assembled.
    if (draft.context !== context || draftIsStale(draft, now)) {
      storage.removeItem(key)
      return []
    }
    return draft.marks
  } catch {
    return []
  }
}

function writeDraftMarks(
  key: string,
  draft: StoredAttendanceDraft,
  storage: Storage | null,
) {
  if (!storage) return

  try {
    storage.setItem(key, JSON.stringify(draft))
  } catch {
    // Quota exhausted, or storage refused the write. Clear what has already
    // expired and try once; a draft that cannot be stored must never cost the
    // coach the register in front of them, so a second failure is swallowed.
    pruneExpiredAttendanceDrafts(storage, draft.savedAt)
    try {
      storage.setItem(key, JSON.stringify(draft))
    } catch {
      // Nothing further to try. The marks remain in component state.
    }
  }
}

function clearDraft(key: string, storage: Storage | null) {
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    // Same tolerance as the write path.
  }
}

export function readPlayerAttendanceDraft(
  occurrenceId: string,
  options: DraftStorageOptions = {},
): SessionAttendanceChange[] {
  return readDraftMarks(playerAttendanceDraftKey(occurrenceId), occurrenceId, options)
    .map((mark) => ({
      choice: mark.choice,
      expectedChoice: mark.expected,
      occurrenceId,
      playerId: mark.subject,
    }))
}

export function persistPlayerAttendanceDraft(
  occurrenceId: string,
  changes: SessionAttendanceChange[],
  { now = Date.now(), storage = attendanceDraftStorage() }: DraftStorageOptions = {},
) {
  const key = playerAttendanceDraftKey(occurrenceId)
  if (!changes.length) {
    clearDraft(key, storage)
    return
  }
  writeDraftMarks(key, {
    context: occurrenceId,
    marks: changes.map((change) => ({
      choice: change.choice,
      expected: change.expectedChoice,
      subject: change.playerId,
    })),
    savedAt: now,
  }, storage)
}

export function discardPlayerAttendanceDraft(
  occurrenceId: string,
  { storage = attendanceDraftStorage() }: DraftStorageOptions = {},
) {
  clearDraft(playerAttendanceDraftKey(occurrenceId), storage)
}

export function readStaffAttendanceDraft(
  dateKey: string,
  options: DraftStorageOptions = {},
): StaffAttendanceChange[] {
  return readDraftMarks(staffAttendanceDraftKey(dateKey), dateKey, options)
    .map((mark) => ({
      choice: mark.choice,
      coachAccountId: mark.subject,
      dateKey,
      expectedChoice: mark.expected,
    }))
}

export function persistStaffAttendanceDraft(
  dateKey: string,
  changes: StaffAttendanceChange[],
  { now = Date.now(), storage = attendanceDraftStorage() }: DraftStorageOptions = {},
) {
  const key = staffAttendanceDraftKey(dateKey)
  if (!changes.length) {
    clearDraft(key, storage)
    return
  }
  writeDraftMarks(key, {
    context: dateKey,
    marks: changes.map((change) => ({
      choice: change.choice,
      expected: change.expectedChoice,
      subject: change.coachAccountId,
    })),
    savedAt: now,
  }, storage)
}

export function discardStaffAttendanceDraft(
  dateKey: string,
  { storage = attendanceDraftStorage() }: DraftStorageOptions = {},
) {
  clearDraft(staffAttendanceDraftKey(dateKey), storage)
}

/**
 * A mark carries the value its cell held when the coach tapped it, and the
 * server compares that value before it writes: `currentChoice !==
 * change.expectedChoice` raises CONFLICT in `lib/sessions/service.ts` and in the
 * matching guard in `lib/coach/staff-attendance.ts`. That expectation is honest
 * for marks made minutes ago and wrong for a draft, which outlives the page that
 * made it by up to a week. Anything that writes the register in between — the
 * same head coach finishing it on a laptop, a draft reopened days later — moves
 * the stored value, and an expectation frozen at mark time can then never be
 * satisfied. Reopening the page does not clear it either, because the restore
 * brings the same stored expectation back, so the "Refresh and try again." the
 * coach is shown is advice that cannot work.
 *
 * Rebasing on restore makes a draft the set of intentions it always was rather
 * than a frozen transaction. Each mark is re-expressed against what the register
 * holds now: one the register already agrees with is dropped, because the
 * service skips it as a no-op anyway and presenting it as unsaved work asks the
 * coach to save something that is already true; every other mark keeps the
 * coach's choice and expects the current value, so the guard goes back to
 * protecting against writes that land after this restore.
 *
 * `changedUnderneath` counts the marks whose ground moved while the draft sat in
 * storage. Those are restored rather than dropped — the coach's mark is still a
 * deliberate statement about who was on court — but they are the ones worth
 * naming, because the register beneath them is no longer the one they were made
 * against.
 *
 * The rebased set is deliberately not written back. Both readers rebase before
 * they use what they read, so storage never has to be corrected for the marks to
 * save; what it does have to keep is the expectation the coach marked against,
 * because that is the only thing `changedUnderneath` can be measured from. Store
 * the rebased expectation instead and every restore after the first counts zero
 * — and the first is the one the coach usually never sees, because the recorder
 * is keyed on the selection and the navigation that follows the tap remounts it.
 */
export type RebasedAttendanceDraft<Change> = {
  changedUnderneath: number
  changes: Change[]
}

export function rebaseRestoredAttendanceDraft<Change extends {
  choice: AttendanceDraftChoice
  expectedChoice: AttendanceDraftChoice
}>(
  restored: Change[],
  storedChoice: (change: Change) => AttendanceDraftChoice,
): RebasedAttendanceDraft<Change> {
  let changedUnderneath = 0
  const changes: Change[] = []

  for (const change of restored) {
    const stored = storedChoice(change)
    if (stored === change.choice) continue
    if (stored !== change.expectedChoice) changedUnderneath += 1
    changes.push({ ...change, expectedChoice: stored })
  }

  return { changedUnderneath, changes }
}

/**
 * A silent restore is its own hazard: marks that look saved but are not. The
 * count reuses the wording the register already shows for unsaved work, and the
 * closing clause names the button the coach has to press.
 *
 * `changedUnderneath` is the rebase's count of marks whose stored value moved
 * while the draft waited. It sits between the two so the closing clause stays
 * last: what is on screen, then what changed beneath it, then that none of it is
 * recorded yet.
 */
export function restoredAttendanceDraftNotice(
  count: number,
  saveAction: string,
  changedUnderneath = 0,
) {
  return `${count} unsaved ${count === 1 ? "change" : "changes"} restored from an`
    + ` earlier visit.${changedUnderneath
      ? ` ${changedUnderneath} ${changedUnderneath === 1 ? "was" : "were"} marked`
        + " differently elsewhere since."
      : ""}`
    + ` Nothing is recorded until you ${saveAction}`
}
