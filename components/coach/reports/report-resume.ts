"use client"

import { useCallback, useEffect, useState } from "react"

import type { CoachReportResumePoint } from "@/lib/coach/types"

export const REPORT_RESUME_STORAGE_KEY = "smba-coach-report-resume-v1"

export function parseReportResumePoint(value: string | null): CoachReportResumePoint | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object") return null

    const candidate = parsed as Record<string, unknown>
    if (typeof candidate.month !== "string" || typeof candidate.playerId !== "string") {
      return null
    }

    return {
      month: candidate.month,
      playerId: candidate.playerId,
    }
  } catch {
    return null
  }
}

export function shouldPersistResumeForDirtyTransition(
  wasDirty: boolean,
  isDirty: boolean,
) {
  return !wasDirty && isDirty
}

export function persistReportResumePoint(
  storage: Pick<Storage, "setItem">,
  resumePoint: CoachReportResumePoint,
) {
  storage.setItem(REPORT_RESUME_STORAGE_KEY, JSON.stringify(resumePoint))
}

export function useReportResume() {
  const [resumePoint, setResumePointState] = useState<CoachReportResumePoint | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedResumePoint = parseReportResumePoint(
          window.localStorage.getItem(REPORT_RESUME_STORAGE_KEY),
        )
        if (storedResumePoint) setResumePointState(storedResumePoint)
      } catch {
        // The resume hint may be unavailable in private browsing; report data remains in SQLite.
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  const setReportResume = useCallback((nextResumePoint: CoachReportResumePoint) => {
    setResumePointState(nextResumePoint)
    try {
      persistReportResumePoint(window.localStorage, nextResumePoint)
    } catch {
      // The resume hint may be unavailable in private browsing; report data remains in SQLite.
    }
  }, [])

  return { resumePoint, setReportResume }
}
