"use client"

import { useEffect } from "react"

import type { ClientErrorBoundary } from "@/lib/telemetry/error-report"
import { reportClientError } from "@/lib/telemetry/report-client-error"

/**
 * Reports the error an error boundary was handed, once per fault.
 *
 * The import graph behind this hook is React plus two dependency-free modules,
 * which is what makes it safe to call from app/global-error.tsx: that boundary
 * renders when the root layout itself has failed, so anything it touches has to
 * be independent of fonts, stylesheets and the database.
 */
export function useErrorReport(boundary: ClientErrorBoundary, error: unknown) {
  useEffect(() => {
    reportClientError({ boundary, error })
  }, [boundary, error])
}
