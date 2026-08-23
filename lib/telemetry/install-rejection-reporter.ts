import { reportClientError } from "@/lib/telemetry/report-client-error"

// A rejected promise from an async event handler has no error boundary to land
// in: React never sees it, so the six branded boundaries never render and the
// only trace is the browser console on the user's own machine. This closes that
// gap. It is installed from instrumentation-client.ts so it runs once, before
// the application's own client code, on every route -- including the ones such
// as /login and /recover that have no layout of their own.

let installed = false

export function installRejectionReporter() {
  if (installed || typeof window === "undefined") return
  installed = true

  try {
    window.addEventListener("unhandledrejection", (event) => {
      reportClientError({
        boundary: "window",
        error: event.reason,
        eventType: "unhandled_rejection",
      })
    })
  } catch {
    // Instrumentation runs before the application does. Failing to attach a
    // listener must not be the reason the portal does not start.
  }
}
