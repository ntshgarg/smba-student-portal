import {
  CLIENT_ERROR_REPORT_ENDPOINT,
  type ClientErrorBoundary,
  type ClientErrorReport,
  type ClientErrorReportType,
  clientErrorSignature,
  describeReportedError,
  toRoutePattern,
} from "@/lib/telemetry/error-report"

// A browser-side reporter for the branded error boundaries. Three properties
// matter more than completeness:
//
//   1. It never throws. Reporting runs inside an error boundary, so a throw here
//      would be caught by the same boundary that invoked us and we would render,
//      report, throw and render again. Every path is wrapped.
//   2. It never blocks. sendBeacon hands the request to the browser and returns;
//      the fetch fallback is not awaited.
//   3. It never retries. A failed report is lost on purpose. Nothing about this
//      page is worth a second request.
//
// Deliberately no server-only imports: this module is bundled for the client.

const MAX_REPORTS_PER_PAGE_LOAD = 8

const reportedSignatures = new Set<string>()
let reportsSent = 0
let reporting = false

function dispatch(body: string) {
  // sendBeacon cannot reject, which keeps our own transport out of the
  // unhandledrejection handler that also feeds this reporter.
  if (typeof navigator.sendBeacon === "function") {
    const queued = navigator.sendBeacon(
      CLIENT_ERROR_REPORT_ENDPOINT,
      new Blob([body], { type: "application/json" }),
    )
    if (queued) return
  }

  // The fallback's rejection is swallowed here rather than left to bubble, for
  // the same reason: an unhandled rejection from the reporter would come back
  // through the reporter.
  void fetch(CLIENT_ERROR_REPORT_ENDPOINT, {
    body,
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined)
}

export function reportClientError(input: {
  boundary: ClientErrorBoundary
  error: unknown
  eventType?: ClientErrorReportType
}) {
  if (typeof window === "undefined") return
  // Re-entrancy guard for the synchronous case, where reporting one failure
  // somehow produces another before the first call returns.
  if (reporting) return
  reporting = true

  try {
    if (reportsSent >= MAX_REPORTS_PER_PAGE_LOAD) return

    const { digest, errorName, summary } = describeReportedError(input.error)
    const report: ClientErrorReport = {
      boundary: input.boundary,
      digest,
      errorName,
      eventType: input.eventType ?? "client_error",
      // Masked before it leaves the browser, so the resolved path -- which can
      // hold a player id or an Academy ID -- is never put on the wire.
      routePath: toRoutePattern(window.location?.pathname),
      summary,
    }

    // A boundary can remount many times for one fault. Report each distinct
    // fault once per page load.
    const signature = clientErrorSignature(report)
    if (reportedSignatures.has(signature)) return
    reportedSignatures.add(signature)
    reportsSent += 1

    dispatch(JSON.stringify(report))
  } catch {
    // Reporting is best effort. Losing a report is a smaller problem than
    // breaking the page that is already telling the user something went wrong.
  } finally {
    reporting = false
  }
}
