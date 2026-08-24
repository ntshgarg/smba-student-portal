import { describeFailureCause } from "@/lib/telemetry/failure-cause"

// The shared mechanics of SMBA's private download and export routes: the
// response headers, the authorisation preamble, the attachment filename, the
// cursor drain that builds a streamed export, and the terminal failure.
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
 * Yields every item across a cursor-paged read. `seen` stops a service that
 * returns a cursor it already returned from streaming an export forever.
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
    if (!page.nextCursor || seen.has(page.nextCursor)) return
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
