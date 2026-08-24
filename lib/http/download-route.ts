import { describeFailureCause } from "@/lib/telemetry/failure-cause"

// The shared mechanics of SMBA's private download and export routes: the
// response headers, the authorisation preamble, the attachment filename, the
// cursor drain that builds a streamed export, the terminal failure, and the log
// a streamed export leaves when it stops short. The words that failure puts in
// the file itself belong to the encoder writing it
// (`lib/finance/csv-truncation.ts`).
//
// Authorisation is deliberately *not* decided here. These routes guard a
// player's own report, a head coach's publication archive and the academy's
// finance exports, and those are three different rules. Each route passes its
// own gate; this module only owns the shape of the refusal.

/**
 * `private, no-store` keeps a financial or report attachment out of shared and
 * browser caches; `nosniff` stops a browser re-interpreting the body as
 * something it can execute. Every private download answers with both, on the
 * success path and on every refusal.
 */
export const PRIVATE_DOWNLOAD_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const

export function privateDownloadResponse(body: string, status: number) {
  return new Response(body, { headers: PRIVATE_DOWNLOAD_HEADERS, status })
}

export function privateAttachmentResponse(
  body: BodyInit,
  attachment: { contentType: string; fileName: string },
) {
  return new Response(body, {
    headers: {
      ...PRIVATE_DOWNLOAD_HEADERS,
      "Content-Disposition": `attachment; filename="${attachment.fileName}"`,
      "Content-Type": attachment.contentType,
    },
  })
}

/**
 * Reduces a display string to an attachment filename, so a player name can
 * never carry a quote, a path separator or a header break into
 * `Content-Disposition`. Decomposes first so an accented name keeps its letters
 * instead of losing them to the hyphen class.
 */
export function safeFileName(value: string, fallback: string) {
  const normalized = value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120)
  return normalized || fallback
}

/** Throws when the identity must not proceed. */
export type DownloadAccessGate<I> = {
  check: (identity: I) => void
  deniedMessage: string
}

export type DownloadAuthorization<I> =
  | { allowed: true; identity: I }
  | { allowed: false; rejection: Response }

/**
 * The authorisation preamble: the caller must be signed in as `requiredRole`,
 * and must then satisfy the route's own `gate` if it has one. A route with no
 * further rule than its role passes no gate.
 */
export function authorizeDownload<I extends { role: string }>(
  identity: I | null,
  requiredRole: I["role"],
  gate?: DownloadAccessGate<I>,
): DownloadAuthorization<I> {
  if (!identity || identity.role !== requiredRole) {
    return {
      allowed: false,
      rejection: privateDownloadResponse("Authentication required.", 401),
    }
  }

  if (gate) {
    try {
      gate.check(identity)
    } catch {
      return {
        allowed: false,
        rejection: privateDownloadResponse(gate.deniedMessage, 403),
      }
    }
  }

  return { allowed: true, identity }
}

/**
 * Raised when a cursor-paged read hands back a cursor it has already returned.
 *
 * Reachable because the finance readers rebuild the whole result set on every
 * page and recompute the cursor from it (`paginateById` in
 * `lib/finance/records.ts`), so rows that move between two reads can put a
 * page's last id back on one already handed out.
 */
export class RepeatedCursorError extends Error {
  constructor() {
    super("The paged read returned a cursor it had already returned.")
    this.name = "RepeatedCursorError"
  }
}

/**
 * Yields every item across a cursor-paged read. `seen` stops a service that
 * returns a cursor it already returned from streaming an export forever.
 *
 * That stop throws rather than returns. Returning ends the drain exactly as a
 * complete read ends it, so the export would close with no trailer and no row
 * count and the coach would hold a file that stops mid-register saying nothing
 * -- the silence F-17 exists to remove. Throwing puts it on the same path as a
 * failed page read, which the encoder answers in the file.
 */
export function* drainCursorPages<P extends { nextCursor: string | null }, T>(
  first: P,
  itemsOf: (page: P) => Iterable<T>,
  pageAfter: (cursor: string) => P,
): Generator<T> {
  let page = first
  const seen = new Set<string>()

  while (true) {
    yield* itemsOf(page)
    if (!page.nextCursor) return
    if (seen.has(page.nextCursor)) throw new RepeatedCursorError()
    seen.add(page.nextCursor)
    page = pageAfter(page.nextCursor)
  }
}

/**
 * The terminal failure of a download route: a 500 that tells the caller nothing
 * about the academy's data, and a log line that tells an operator what actually
 * broke. The cause is redacted rather than dropped -- dropping it is what made
 * every 500 on this surface undiagnosable.
 */
export function downloadFailureResponse(error: unknown, failure: {
  context?: Record<string, unknown>
  label: string
  message: string
}) {
  console.error(failure.label, {
    ...failure.context,
    cause: describeFailureCause(error),
  })
  return privateDownloadResponse(failure.message, 500)
}

/**
 * The mid-stream counterpart of `downloadFailureResponse`.
 *
 * A streamed export's pages are pulled after the handler has returned, so by
 * the time one of them fails there is no response left to change: 200 and
 * `Content-Disposition` are on the wire and the route's `catch` has been out of
 * scope for some time. All that remains is the log, so it gets the same cause
 * and the same route context a 500 would have carried, plus how far the export
 * got before it stopped. What the coach holding the file is told is decided
 * separately, by whoever knows the domain the failure came from
 * (`financeExportTruncation` in `lib/http/finance-download-route.ts`).
 *
 * Draining every page inside the handler's `try` instead would put the read
 * failures back where a 500 could answer them, and it is not what these routes
 * do, for two reasons. The register and activity readers each rebuild their
 * whole result set per page (`lib/finance/records.ts`), so buffering adds a
 * second full copy the function must hold while it waits, on the two exports
 * with no date filter to bound them. And it would only move the read failures:
 * the CSV encoders reject an unrepresentable amount as they write, so the file
 * could still end mid-row with a 200 already sent. The notice the encoders
 * write covers both.
 */
export function exportTruncationLog(failure: {
  context?: Record<string, unknown>
  label: string
}) {
  return (error: unknown, rowsWritten: number) => {
    console.error(failure.label, {
      ...failure.context,
      cause: describeFailureCause(error),
      rowsWritten,
    })
  }
}
