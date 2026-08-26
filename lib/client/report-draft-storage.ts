/**
 * A monthly report's text lives in component state until the coach presses
 * "Save draft", so until now a discarded page took every character with it. The
 * two attendance registers already have this cover in
 * `lib/client/attendance-draft-storage.ts`; the report workspace is the
 * product's one long-form input and it did not.
 *
 * What made the gap easy to miss is that the workspace already wrote *something*
 * on the first keystroke -- `components/coach/reports/report-resume.ts` stores
 * `{ month, playerId }`. That is a pointer to the report, not the report. A
 * coach whose tab was reclaimed came back to the queue with the right player
 * sorted to the top and an empty textarea.
 *
 * Conventions follow the attendance module exactly: a versioned key, a parser
 * that rejects anything it does not recognise, callers that treat storage as
 * optional rather than load-bearing, and a rebase on restore so a draft is the
 * intention it always was rather than a frozen transaction.
 */
const REPORT_DRAFT_KEY_PREFIX = "smba-report-draft-v1"

/**
 * The same week the registers use, and for the same reason rather than for
 * symmetry: the key pins a draft to one player and one month, so age is the only
 * thing it cannot express, and a paragraph abandoned in one sitting should not
 * resurface as "unsaved" long after the coach has forgotten writing it.
 *
 * A month's reports are written over days, which is longer than a register's
 * cycle, but that does not argue for a longer life here -- work the coach means
 * to keep across days has "Save draft", which puts it in SQLite. This store only
 * has to cover the gap between a keystroke and the next explicit save.
 */
export const REPORT_DRAFT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000

/**
 * `baseline` is the saved report text the draft was written against. It is the
 * report equivalent of the per-mark `expected` the attendance drafts keep, and
 * it is stored for the same reason: without it a restore cannot tell "the coach
 * has unsaved edits" from "the coach has unsaved edits *and* the saved report
 * moved underneath them", and the second is the one worth saying out loud.
 *
 * `context` repeats what the key already pins so a record written under one
 * player and month can never be read back under another, however the key was
 * assembled.
 */
type StoredReportDraft = {
  baseline: string
  context: string
  savedAt: number
  text: string
}

type ReportDraftStorageOptions = {
  now?: number
  storage?: Storage | null
}

/**
 * Private browsing and blocked site data can throw on the property access
 * itself, not only on `setItem`. A null result means drafts are unavailable and
 * the workspace degrades to holding text in component state alone.
 */
export function reportDraftStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage
  } catch {
    return null
  }
}

export function reportDraftContext(playerId: string, month: string) {
  return `${playerId}:${month}`
}

export function reportDraftKey(playerId: string, month: string) {
  return `${REPORT_DRAFT_KEY_PREFIX}:${reportDraftContext(playerId, month)}`
}

/**
 * Rejects the whole record rather than salvaging part of it. A field that fails
 * validation means the payload is not the shape this version writes, and a
 * partial restore would put half a paragraph in front of the coach as though it
 * were what they wrote.
 */
export function parseReportDraft(value: string | null): StoredReportDraft | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object") return null

    const candidate = parsed as Record<string, unknown>
    if (typeof candidate.context !== "string" || !candidate.context) return null
    if (typeof candidate.savedAt !== "number" || !Number.isFinite(candidate.savedAt)) return null
    if (typeof candidate.text !== "string") return null
    if (typeof candidate.baseline !== "string") return null

    return {
      baseline: candidate.baseline,
      context: candidate.context,
      savedAt: candidate.savedAt,
      text: candidate.text,
    }
  } catch {
    return null
  }
}

/**
 * Compared symmetrically so a device whose clock has moved backwards discards
 * its drafts rather than holding one that can never expire.
 */
function draftIsStale(draft: StoredReportDraft, now: number) {
  return Math.abs(now - draft.savedAt) > REPORT_DRAFT_LIFETIME_MS
}

/**
 * Bounds what a device accumulates without needing a background job. A month is
 * 94 players against a 5,000-character ceiling, so an unpruned store could hold
 * a few hundred kilobytes of abandoned paragraphs. Called on the read path, so
 * it runs once when an editor mounts rather than on every keystroke, and again
 * before a write is retried after quota exhaustion.
 */
export function pruneExpiredReportDrafts(storage: Storage, now: number) {
  try {
    const expired: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key?.startsWith(REPORT_DRAFT_KEY_PREFIX)) continue
      const draft = parseReportDraft(storage.getItem(key))
      if (!draft || draftIsStale(draft, now)) expired.push(key)
    }
    for (const key of expired) storage.removeItem(key)
  } catch {
    // Storage may disappear mid-iteration or refuse removal; drafts are a
    // convenience and the editor keeps working without them.
  }
}

export function readReportDraft(
  playerId: string,
  month: string,
  { now = Date.now(), storage = reportDraftStorage() }: ReportDraftStorageOptions = {},
): StoredReportDraft | null {
  if (!storage) return null

  const key = reportDraftKey(playerId, month)
  try {
    pruneExpiredReportDrafts(storage, now)
    const draft = parseReportDraft(storage.getItem(key))
    if (!draft) {
      storage.removeItem(key)
      return null
    }
    if (draft.context !== reportDraftContext(playerId, month) || draftIsStale(draft, now)) {
      storage.removeItem(key)
      return null
    }
    return draft
  } catch {
    return null
  }
}

export function persistReportDraft(
  playerId: string,
  month: string,
  { baseline, text }: { baseline: string; text: string },
  { now = Date.now(), storage = reportDraftStorage() }: ReportDraftStorageOptions = {},
) {
  const key = reportDraftKey(playerId, month)
  if (!storage) return

  // Text that matches what is already saved is not unsaved work. Clearing here
  // rather than storing a no-op keeps a coach who types a word and deletes it
  // from being told on their next visit that something is waiting for them.
  if (text === baseline) {
    try {
      storage.removeItem(key)
    } catch {
      // Same tolerance as the write path.
    }
    return
  }

  const draft: StoredReportDraft = {
    baseline,
    context: reportDraftContext(playerId, month),
    savedAt: now,
    text,
  }
  try {
    storage.setItem(key, JSON.stringify(draft))
  } catch {
    // Quota exhausted, or storage refused the write. Clear what has already
    // expired and try once; a draft that cannot be stored must never cost the
    // coach the paragraph in front of them, so a second failure is swallowed.
    pruneExpiredReportDrafts(storage, now)
    try {
      storage.setItem(key, JSON.stringify(draft))
    } catch {
      // Nothing further to try. The text remains in component state.
    }
  }
}

export function discardReportDraft(
  playerId: string,
  month: string,
  { storage = reportDraftStorage() }: ReportDraftStorageOptions = {},
) {
  if (!storage) return
  try {
    storage.removeItem(reportDraftKey(playerId, month))
  } catch {
    // Same tolerance as the write path.
  }
}

export type RebasedReportDraft = {
  /**
   * True when the saved report moved while the draft sat in storage -- the same
   * head coach finishing it on a laptop, or a draft reopened days later. The
   * coach's text is still restored, because it is a deliberate statement about
   * the player, but it is no longer an edit of what is on the server.
   */
  changedUnderneath: boolean
  text: string
}

/**
 * Re-expresses a stored draft against what the report holds now.
 *
 * Returns null when there is nothing to restore, which covers the case that
 * matters most: the draft and the saved report now say the same thing, because
 * the coach did press "Save draft" before the tab went away, or finished the
 * same edit on another device. Presenting that as unsaved work would ask them to
 * save something that is already true, and would put an "Unsaved changes" notice
 * on a report that has none.
 */
export function rebaseRestoredReportDraft(
  draft: StoredReportDraft | null,
  storedText: string,
): RebasedReportDraft | null {
  if (!draft) return null
  if (draft.text === storedText) return null
  return { changedUnderneath: draft.baseline !== storedText, text: draft.text }
}

/**
 * A silent restore is its own hazard: a paragraph that looks saved and is not.
 * The wording follows `restoredAttendanceDraftNotice` -- what is on screen, then
 * what changed beneath it, then the closing clause naming the button the coach
 * has to press.
 */
export function restoredReportDraftNotice(changedUnderneath: boolean) {
  return "Unsaved report text restored from an earlier visit."
    + (changedUnderneath ? " The saved report has changed since." : "")
    + " Nothing is recorded until you save the draft"
}
