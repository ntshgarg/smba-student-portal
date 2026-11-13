// cursors = anchor id of every earlier page. Read whole (never through the 120-char query cut); a malformed or over-long trail reads as page 1.

/** How many pages a records list can be stepped through with Next. */
export const RECORDS_PAGE_LIMIT = 100

/** Longer than any row id the records lists page by. */
const MAX_CURSOR_LENGTH = 200

export function readRecordsTrail(value: string | string[] | undefined): string[] {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim()
  if (!raw) return []
  const cursors = raw.split(",")
  // The trail of the last page has one entry fewer than the page count.
  if (cursors.length > RECORDS_PAGE_LIMIT - 1) return []
  if (cursors.some((cursor) => cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH)) return []
  return cursors
}

/** Whether a page whose trail is `trail` may offer Next. */
export function recordsTrailCanGrow(trail: string[]) {
  return trail.length + 1 < RECORDS_PAGE_LIMIT
}
