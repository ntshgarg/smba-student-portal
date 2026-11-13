"use client"

import { useRouter } from "next/navigation"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import {
  publishAttendanceAdjustmentAction,
  voidAttendanceAdjustmentAction,
} from "@/app/coach/attendance/adjustments/actions"
import {
  archiveMemberAction,
  cancelSessionOccurrenceAction,
  createSessionSeriesAction,
  endSessionSeriesAction,
  markAcademyHolidaysAction,
  previewAcademyHolidaysAction,
  previewEndSessionSeriesAction,
  replaceSessionOccurrenceAction,
  retractAcademyHolidayAction,
  saveAttendanceRegisterAction,
  saveMemberAction,
} from "@/app/coach/actions"
import type { AttendanceAdjustmentRecord } from "@/lib/attendance/adjustments"
import type { AcademyHolidayRecord } from "@/lib/sessions/holiday-types"
import type { HolidayImpact } from "@/lib/sessions/holidays"
import type { EndSchedulePreview, EndScheduleResult } from "@/lib/sessions/service"
import type { OperationalActionResult } from "@/lib/actions/operational-result"
import { isAcademyMember, joinPlayerMembers } from "@/lib/coach/member-utils"
import type {
  ArchiveMemberInput,
  ArchiveMemberResult,
  MemberMutationResult,
  OperationalAcademyMember,
  OperationalPlayerMemberRecord,
  PlayerMemberRecord,
  PlayerTrainingProfile,
  UpdateMemberInput,
} from "@/lib/coach/types"
import type {
  CreateSessionSeriesInput,
  SessionAssignment,
  SessionAttendanceChange,
  SessionAttendanceRecords,
  TrainingSessionOccurrence,
  TrainingSessionSeries,
} from "@/lib/sessions/types"

type MemberPortalContextValue = {
  activePlayers: OperationalPlayerMemberRecord[]
  players: OperationalPlayerMemberRecord[]
  archiveMember: (input: ArchiveMemberInput) => Promise<ArchiveMemberResult>
  saveMember: (input: UpdateMemberInput) => Promise<MemberMutationResult>
}

type AttendancePortalContextValue = {
  attendanceAdjustments: AttendanceAdjustmentRecord[]
  attendanceRecords: SessionAttendanceRecords
  publishAttendanceAdjustment: (input: {
    completionOccurrenceId: string
    playerId: string
    reason?: string
    sourceOccurrenceId: string
  }) => Promise<OperationalActionResult<AttendanceAdjustmentRecord>>
  saveAttendanceRegister: (
    changes: SessionAttendanceChange[],
  ) => Promise<OperationalActionResult<{ applied: number }>>
  voidAttendanceAdjustment: (
    adjustmentId: string,
  ) => Promise<OperationalActionResult<AttendanceAdjustmentRecord>>
}

type SessionPortalContextValue = {
  academyHolidays: AcademyHolidayRecord[]
  sessionAssignments: SessionAssignment[]
  sessionOccurrences: TrainingSessionOccurrence[]
  sessionSeries: TrainingSessionSeries[]
  cancelSessionOccurrence: (
    occurrenceId: string,
  ) => Promise<OperationalActionResult<ReturnTypeSnapshot>>
  createSessionSeries: (
    input: CreateSessionSeriesInput,
  ) => Promise<OperationalActionResult<CreatedSessionSnapshot>>
  endSessionSeries: (input: {
    seriesId: string
    stopFees: boolean
  }) => Promise<OperationalActionResult<ReturnTypeSnapshot & { closeout: EndScheduleResult }>>
  markAcademyHolidays: (input: {
    dateKeys: string[]
    label: string
    /** The month on screen, so the calendar gets that month back. */
    viewMonth?: string
  }) => Promise<OperationalActionResult<ReturnTypeSnapshot & MarkHolidaysSummary>>
  previewAcademyHolidays: (
    dateKeys: string[],
  ) => Promise<OperationalActionResult<HolidayImpact>>
  previewEndSessionSeries: (
    seriesId: string,
  ) => Promise<OperationalActionResult<EndSchedulePreview>>
  replaceSessionOccurrence: (input: {
    occurrenceId: string
    dateKey: string
    startTime: string
    durationMinutes: number
    venue: string
  }) => Promise<OperationalActionResult<ReturnTypeSnapshot>>
  retractAcademyHoliday: (
    dateKey: string,
  ) => Promise<OperationalActionResult<ReturnTypeSnapshot & {
    keptCancelledSessions: number
    restoredSessions: number
    reviewFlagsCleared: number
  }>>
}

type MarkHolidaysSummary = {
  closedDates: string[]
  skippedDates: string[]
  cancelledSessions: number
  adjustmentsFlaggedForReview: number
}

type ReturnTypeSnapshot = {
  academyHolidays: AcademyHolidayRecord[]
  sessionAssignments: SessionAssignment[]
  sessionOccurrences: TrainingSessionOccurrence[]
  sessionSeries: TrainingSessionSeries[]
}

type CreatedSessionSnapshot = ReturnTypeSnapshot & { createdSeriesId: string }

const MemberPortalContext = createContext<MemberPortalContextValue | null>(null)
const AttendancePortalContext = createContext<AttendancePortalContextValue | null>(null)
const SessionPortalContext = createContext<SessionPortalContextValue | null>(null)

const EMPTY_ATTENDANCE_ADJUSTMENTS: AttendanceAdjustmentRecord[] = []
const EMPTY_ATTENDANCE_RECORDS: SessionAttendanceRecords = {}
const EMPTY_ACADEMY_HOLIDAYS: AcademyHolidayRecord[] = []
const EMPTY_MEMBERS: OperationalAcademyMember[] = []
const EMPTY_SESSION_ASSIGNMENTS: SessionAssignment[] = []
const EMPTY_SESSION_OCCURRENCES: TrainingSessionOccurrence[] = []
const EMPTY_SESSION_SERIES: TrainingSessionSeries[] = []
const EMPTY_TRAINING_PROFILES: PlayerTrainingProfile[] = []

export function CoachPortalProvider({
  children,
  initialAcademyHolidays = EMPTY_ACADEMY_HOLIDAYS,
  initialAttendanceAdjustments = EMPTY_ATTENDANCE_ADJUSTMENTS,
  initialAttendanceRecords = EMPTY_ATTENDANCE_RECORDS,
  initialMembers = EMPTY_MEMBERS,
  initialSessionAssignments = EMPTY_SESSION_ASSIGNMENTS,
  initialSessionOccurrences = EMPTY_SESSION_OCCURRENCES,
  initialSessionSeries = EMPTY_SESSION_SERIES,
  initialTrainingProfiles = EMPTY_TRAINING_PROFILES,
}: {
  children: React.ReactNode
  initialAcademyHolidays?: AcademyHolidayRecord[]
  initialAttendanceAdjustments?: AttendanceAdjustmentRecord[]
  initialAttendanceRecords?: SessionAttendanceRecords
  initialMembers?: OperationalAcademyMember[]
  initialSessionAssignments?: SessionAssignment[]
  initialSessionOccurrences?: TrainingSessionOccurrence[]
  initialSessionSeries?: TrainingSessionSeries[]
  initialTrainingProfiles?: PlayerTrainingProfile[]
}) {
  const router = useRouter()
  const [academyHolidays, setAcademyHolidays] = useState(initialAcademyHolidays)
  const [attendanceAdjustments, setAttendanceAdjustments] = useState(initialAttendanceAdjustments)
  const [attendanceRecords, setAttendanceRecords] = useState(initialAttendanceRecords)
  const [sessionAssignments, setSessionAssignments] = useState(initialSessionAssignments)
  const [sessionOccurrences, setSessionOccurrences] = useState(initialSessionOccurrences)
  const [sessionSeries, setSessionSeries] = useState(initialSessionSeries)
  const [members, setMembers] = useState(initialMembers)
  const [trainingProfiles, setTrainingProfiles] = useState(initialTrainingProfiles)
  const players = useMemo(
    () => joinPlayerMembers(members, trainingProfiles),
    [members, trainingProfiles],
  )
  // Players training now. A term-finished player still holds a place on a
  // schedule that has run out, so is not one of them (lib/sessions/term.ts).
  const activePlayers = useMemo(
    () => players.filter((player) => player.training.status === "active"),
    [players],
  )

  // Server refreshes reconcile academy data without remounting the workspace.
  // Local drafts live in their editing surfaces and therefore survive an
  // unrelated successful save elsewhere on the same page.
  //
  // Holidays are part of that: a refresh that brought new occurrences but kept
  // the old holiday list showed a day as closed after it had been reopened
  // elsewhere, or sessions cancelled with no sign a holiday did it.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAcademyHolidays(initialAcademyHolidays)
      setAttendanceAdjustments(initialAttendanceAdjustments)
      setAttendanceRecords(initialAttendanceRecords)
      setMembers(initialMembers)
      setSessionAssignments(initialSessionAssignments)
      setSessionOccurrences(initialSessionOccurrences)
      setSessionSeries(initialSessionSeries)
      setTrainingProfiles(initialTrainingProfiles)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [
    initialAcademyHolidays,
    initialAttendanceAdjustments,
    initialAttendanceRecords,
    initialMembers,
    initialSessionAssignments,
    initialSessionOccurrences,
    initialSessionSeries,
    initialTrainingProfiles,
  ])

  const saveAttendanceRegister = useCallback(async (
    changes: SessionAttendanceChange[],
  ) => {
    const result = await saveAttendanceRegisterAction({ changes })
    if (!result.ok) return result
    setAttendanceRecords((current) => {
      const next = { ...current }
      changes.forEach((change) => {
        const occurrenceRecords = { ...next[change.occurrenceId] }
        if (change.choice === "cleared") delete occurrenceRecords[change.playerId]
        else occurrenceRecords[change.playerId] = change.choice
        next[change.occurrenceId] = occurrenceRecords
      })
      return next
    })
    return result
  }, [])

  const publishAttendanceAdjustment = useCallback(async (input: {
    completionOccurrenceId: string
    playerId: string
    reason?: string
    sourceOccurrenceId: string
  }) => {
    const result = await publishAttendanceAdjustmentAction(input)
    if (!result.ok) return result
    const published = result.data
    setAttendanceAdjustments((current) => [
      published,
      ...current.filter((item) => item.id !== published.id),
    ])
    router.refresh()
    return result
  }, [router])

  const voidAdjustment = useCallback(async (adjustmentId: string) => {
    const result = await voidAttendanceAdjustmentAction(adjustmentId)
    if (!result.ok) return result
    const voided = result.data
    setAttendanceAdjustments((current) => current.map((item) => (
      item.id === voided.id ? voided : item
    )))
    router.refresh()
    return result
  }, [router])

  /*
   * Every session mutation returns the same window snapshot, and each used to
   * unpack it field by field. Adding a field then meant editing five call
   * sites, and missing one showed up only as a stale calendar. Applying it in
   * one place makes that structural.
   */
  const applySessionSnapshot = useCallback((snapshot: ReturnTypeSnapshot) => {
    setAcademyHolidays(snapshot.academyHolidays)
    setSessionAssignments(snapshot.sessionAssignments)
    setSessionOccurrences(snapshot.sessionOccurrences)
    setSessionSeries(snapshot.sessionSeries)
  }, [])

  /*
   * A session or holiday action the server turns down because the day or the
   * session changed elsewhere -- another tab, another device -- means this
   * screen is out of date. Without a refetch the coach kept the old session and
   * buttons that failed the same way every time until a reload.
   */
  const refreshAfterRefusal = useCallback((result: { ok: boolean; code?: string }) => {
    if (result.ok) return
    if (result.code === "CONFLICT" || result.code === "NOT_FOUND" || result.code === "BUSINESS_RULE") {
      router.refresh()
    }
  }, [router])

  const createSessionSeries = useCallback(async (input: CreateSessionSeriesInput) => {
    const result = await createSessionSeriesAction(input)
    if (!result.ok) return result
    const created = result.data
    applySessionSnapshot(created)
    return result
  }, [applySessionSnapshot])

  const endSeries = useCallback(async (input: { seriesId: string; stopFees: boolean }) => {
    const result = await endSessionSeriesAction(input)
    if (!result.ok) return result
    const snapshot = result.data
    applySessionSnapshot(snapshot)
    router.refresh()
    return result
  }, [applySessionSnapshot, router])

  const cancelOccurrence = useCallback(async (occurrenceId: string) => {
    const result = await cancelSessionOccurrenceAction(occurrenceId)
    if (!result.ok) {
      refreshAfterRefusal(result)
      return result
    }
    const snapshot = result.data
    applySessionSnapshot(snapshot)
    return result
  }, [applySessionSnapshot, refreshAfterRefusal])

  const replaceOccurrence = useCallback(async (input: {
    occurrenceId: string
    dateKey: string
    startTime: string
    durationMinutes: number
    venue: string
  }) => {
    const result = await replaceSessionOccurrenceAction(input)
    if (!result.ok) {
      // A wrong field the coach can fix in the form needs no refetch.
      if (result.field !== "startTime" && result.field !== "durationMinutes" && result.field !== "venue") {
        refreshAfterRefusal(result)
      }
      return result
    }
    const snapshot = result.data
    applySessionSnapshot(snapshot)
    return result
  }, [applySessionSnapshot, refreshAfterRefusal])

  const previewEndSeries = useCallback(
    (seriesId: string) => previewEndSessionSeriesAction(seriesId),
    [],
  )

  const previewHolidays = useCallback(
    (dateKeys: string[]) => previewAcademyHolidaysAction(dateKeys),
    [],
  )

  const markHolidays = useCallback(async (input: {
    dateKeys: string[]
    label: string
    viewMonth?: string
  }) => {
    const result = await markAcademyHolidaysAction(input)
    if (!result.ok) return result
    applySessionSnapshot(result.data)
    // Unlike cancelling one session, a closure can move attendance figures and
    // flag make-ups for review, so the rest of the page is refetched too.
    router.refresh()
    return result
  }, [applySessionSnapshot, router])

  const retractHoliday = useCallback(async (dateKey: string) => {
    const result = await retractAcademyHolidayAction(dateKey)
    if (!result.ok) {
      refreshAfterRefusal(result)
      return result
    }
    applySessionSnapshot(result.data)
    router.refresh()
    return result
  }, [applySessionSnapshot, refreshAfterRefusal, router])

  const saveMember = useCallback(async (input: UpdateMemberInput) => {
    const result = await saveMemberAction(input)
    if (result.ok) {
      setMembers((current) => current.map((member) => (
        member.id === result.record.member.id ? result.record.member : member
      )))
      setTrainingProfiles((current) => current.map((profile) => (
        profile.memberId === result.record.training.memberId
          ? result.record.training
          : profile
      )))
      router.refresh()
    } else if (result.code === "STALE_RECORD") {
      router.refresh()
    }
    return result
  }, [router])

  const archiveMember = useCallback(async (input: ArchiveMemberInput) => {
    const result = await archiveMemberAction(input)
    if (result.ok) {
      setMembers((current) => current.filter((member) => member.id !== result.memberId))
      setTrainingProfiles((current) => current.filter((profile) => (
        profile.memberId !== result.memberId
      )))
      router.refresh()
    } else if (result.code === "STALE_RECORD") {
      router.refresh()
    }
    return result
  }, [router])

  const memberValue = useMemo<MemberPortalContextValue>(() => ({
    activePlayers,
    archiveMember,
    players,
    saveMember,
  }), [activePlayers, archiveMember, players, saveMember])
  const attendanceValue = useMemo<AttendancePortalContextValue>(() => ({
    attendanceAdjustments,
    attendanceRecords,
    publishAttendanceAdjustment,
    saveAttendanceRegister,
    voidAttendanceAdjustment: voidAdjustment,
  }), [
    attendanceAdjustments,
    attendanceRecords,
    publishAttendanceAdjustment,
    saveAttendanceRegister,
    voidAdjustment,
  ])
  const sessionValue = useMemo<SessionPortalContextValue>(() => ({
    academyHolidays,
    cancelSessionOccurrence: cancelOccurrence,
    createSessionSeries,
    endSessionSeries: endSeries,
    markAcademyHolidays: markHolidays,
    previewAcademyHolidays: previewHolidays,
    previewEndSessionSeries: previewEndSeries,
    replaceSessionOccurrence: replaceOccurrence,
    retractAcademyHoliday: retractHoliday,
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  }), [
    academyHolidays,
    cancelOccurrence,
    createSessionSeries,
    endSeries,
    markHolidays,
    previewEndSeries,
    previewHolidays,
    replaceOccurrence,
    retractHoliday,
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  ])

  return (
    <MemberPortalContext.Provider value={memberValue}>
      <AttendancePortalContext.Provider value={attendanceValue}>
        <SessionPortalContext.Provider value={sessionValue}>
          {children}
        </SessionPortalContext.Provider>
      </AttendancePortalContext.Provider>
    </MemberPortalContext.Provider>
  )
}

function useRequiredContext<Value>(
  context: React.Context<Value | null>,
  hookName: string,
) {
  const value = useContext(context)
  if (!value) throw new Error(`${hookName} must be used within CoachPortalProvider`)
  return value
}

export function useMemberPortal() {
  return useRequiredContext(MemberPortalContext, "useMemberPortal")
}

export function useAttendancePortal() {
  return useRequiredContext(AttendancePortalContext, "useAttendancePortal")
}

export function useSessionPortal() {
  return useRequiredContext(SessionPortalContext, "useSessionPortal")
}

export function useMemberDirectoryPortal() {
  const memberContext = useMemberPortal()
  const sessionContext = useSessionPortal()
  /**
   * The narrowing is a `filter`, so returning its result directly handed every
   * render a new array. Two of the Member Directory's three `useMemo`s key off
   * `players` — `buildMemberDirectoryIndex`, which builds five Maps over the
   * whole roster, and the search-and-sort, which copies the roster and
   * `localeCompare`s it — and both were therefore recomputed on every keystroke
   * in the search box, every row expansion and every reveal. The context value
   * this reads is itself a `useMemo` over the provider's member and
   * training-profile state, so keying on it invalidates exactly when the roster
   * changes and no more often.
   */
  const players = useMemo(
    () => memberContext.players.filter(
      (player): player is PlayerMemberRecord => isAcademyMember(player.member),
    ),
    [memberContext.players],
  )
  // As above: "finished" players are not training, so they are not active.
  const activePlayers = useMemo(
    () => players.filter((player) => player.training.status === "active"),
    [players],
  )

  if (players.length !== memberContext.players.length) {
    throw new Error("Member Directory requires complete private member records")
  }

  return {
    ...memberContext,
    ...sessionContext,
    activePlayers,
    players,
  }
}
