/*
 * The page trail in a Fee records address: `cursors` holds the anchor row of
 * every page before the current one, so Previous can step back and the range
 * label ("31–40") can count the rows before this page.
 *
 * It used to be read through the same 120-character cut as a search box. Row
 * ids are 36 characters, so the trail of page 5 (four ids, 147 characters) was
 * cut mid-id, the cut id matched no row, and Next on page 4 opened the
 * "Financials are unavailable" screen once a list passed 40 rows.
 *
 * It is read here instead, whole, by both the records page and the player
 * record's back link. A trail that is too long or malformed reads as page 1,
 * which is what a hand-edited or stale address should do.
 */

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
