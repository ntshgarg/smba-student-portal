import "server-only"

import { getPlayerAttendanceInput } from "@/lib/attendance/database"
import {
  calculateMonthlyAttendance,
  parseAttendanceSnapshot,
  type AttendanceBreakdown,
} from "@/lib/attendance/domain"
import { getIndiaDateKey } from "@/lib/coach/attendance-rules"
import type { SmbaDatabaseExecutor } from "@/lib/db/client"

const EMPTY_ATTENDANCE: AttendanceBreakdown = {
  eligible: 0,
  recorded: 0,
  attended: 0,
  absent: 0,
  pending: 0,
  percentage: null,
}

/**
 * Resolve the immutable attendance represented by one report publication.
 * Modern publications use their stored snapshot. Legacy rows without a valid
 * snapshot are deterministically recalculated at the publication instant.
 */
export function resolvePublishedReportAttendance({
  attendanceSnapshot,
  database,
  month,
  playerId,
  publishedAt,
}: {
  attendanceSnapshot: string | null
  database?: SmbaDatabaseExecutor
  month: string
  playerId: string
  publishedAt: Date
}): AttendanceBreakdown {
  if (attendanceSnapshot) {
    try {
      const parsed = parseAttendanceSnapshot(JSON.parse(attendanceSnapshot))
      if (parsed?.month === month) {
        return {
          eligible: parsed.eligible,
          recorded: parsed.recorded,
          attended: parsed.attended,
          absent: parsed.absent,
          pending: parsed.pending,
          percentage: parsed.percentage,
        }
      }
    } catch {
      // Invalid legacy snapshots intentionally use the deterministic fallback.
    }
  }

  const referenceInstant = publishedAt.toISOString()
  const input = getPlayerAttendanceInput(
    playerId,
    month,
    getIndiaDateKey(publishedAt),
    referenceInstant,
    database,
  )
  return input ? calculateMonthlyAttendance(input) : { ...EMPTY_ATTENDANCE }
}
