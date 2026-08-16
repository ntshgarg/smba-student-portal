"use client"

import { useRouter } from "next/navigation"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import {
  publishAttendanceAdjustmentAction,
  voidAttendanceAdjustmentAction,
} from "@/app/coach/attendance/adjustments/actions"
import {
  assignSessionAction,
  archiveMemberAction,
  cancelSessionOccurrenceAction,
  createSessionSeriesAction,
  endSessionAssignmentAction,
  endSessionSeriesAction,
  publishReportAction,
  replaceSessionOccurrenceAction,
  saveAttendanceRegisterAction,
  saveMemberAction,
  saveReportDraftAction,
} from "@/app/coach/actions"
import type { AttendanceAdjustmentRecord } from "@/lib/attendance/adjustments"
import type { OperationalActionResult } from "@/lib/actions/operational-result"
import { isAcademyMember, joinPlayerMembers } from "@/lib/coach/member-utils"
import type {
  ArchiveMemberInput,
  ArchiveMemberResult,
  CoachMonthlyReportRecord,
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
import type {
  PublishReportInput,
  ReportMutationResult,
  SaveReportDraftInput,
} from "@/lib/reports/contracts"

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
  sessionAssignments: SessionAssignment[]
  sessionOccurrences: TrainingSessionOccurrence[]
  sessionSeries: TrainingSessionSeries[]
  assignSession: (input: {
    effectiveFrom: string
    playerId: string
    seriesId: string
    weekdays: number[]
  }) => Promise<OperationalActionResult<ReturnTypeSnapshot>>
  cancelSessionOccurrence: (
    occurrenceId: string,
  ) => Promise<OperationalActionResult<ReturnTypeSnapshot>>
  createSessionSeries: (
    input: CreateSessionSeriesInput,
  ) => Promise<OperationalActionResult<CreatedSessionSnapshot>>
  endSessionAssignment: (input: {
    assignmentId: string
    effectiveTo: string
  }) => Promise<OperationalActionResult<ReturnTypeSnapshot>>
  endSessionSeries: (
    seriesId: string,
  ) => Promise<OperationalActionResult<ReturnTypeSnapshot>>
  replaceSessionOccurrence: (input: {
    occurrenceId: string
    dateKey: string
    startTime: string
    durationMinutes: number
    venue: string
  }) => Promise<OperationalActionResult<ReturnTypeSnapshot>>
}

type ReportPortalContextValue = {
  reports: CoachMonthlyReportRecord[]
  publishReport: (input: PublishReportInput) => Promise<ReportMutationResult>
  saveReportDraft: (input: SaveReportDraftInput) => Promise<ReportMutationResult>
}

type ReturnTypeSnapshot = {
  sessionAssignments: SessionAssignment[]
  sessionOccurrences: TrainingSessionOccurrence[]
  sessionSeries: TrainingSessionSeries[]
}

type CreatedSessionSnapshot = ReturnTypeSnapshot & { createdSeriesId: string }

const MemberPortalContext = createContext<MemberPortalContextValue | null>(null)
const AttendancePortalContext = createContext<AttendancePortalContextValue | null>(null)
const SessionPortalContext = createContext<SessionPortalContextValue | null>(null)
const ReportPortalContext = createContext<ReportPortalContextValue | null>(null)

const EMPTY_ATTENDANCE_ADJUSTMENTS: AttendanceAdjustmentRecord[] = []
const EMPTY_ATTENDANCE_RECORDS: SessionAttendanceRecords = {}
const EMPTY_MEMBERS: OperationalAcademyMember[] = []
const EMPTY_REPORTS: CoachMonthlyReportRecord[] = []
const EMPTY_SESSION_ASSIGNMENTS: SessionAssignment[] = []
const EMPTY_SESSION_OCCURRENCES: TrainingSessionOccurrence[] = []
const EMPTY_SESSION_SERIES: TrainingSessionSeries[] = []
const EMPTY_TRAINING_PROFILES: PlayerTrainingProfile[] = []

function replaceReport(
  reports: CoachMonthlyReportRecord[],
  report: CoachMonthlyReportRecord,
) {
  const existing = reports.some((item) => item.id === report.id)
  return existing
    ? reports.map((item) => item.id === report.id ? report : item)
    : [...reports, report]
}

export function CoachPortalProvider({
  children,
  initialAttendanceAdjustments = EMPTY_ATTENDANCE_ADJUSTMENTS,
  initialAttendanceRecords = EMPTY_ATTENDANCE_RECORDS,
  initialMembers = EMPTY_MEMBERS,
  initialReports = EMPTY_REPORTS,
  initialSessionAssignments = EMPTY_SESSION_ASSIGNMENTS,
  initialSessionOccurrences = EMPTY_SESSION_OCCURRENCES,
  initialSessionSeries = EMPTY_SESSION_SERIES,
  initialTrainingProfiles = EMPTY_TRAINING_PROFILES,
}: {
  children: React.ReactNode
  initialAttendanceAdjustments?: AttendanceAdjustmentRecord[]
  initialAttendanceRecords?: SessionAttendanceRecords
  initialMembers?: OperationalAcademyMember[]
  initialReports?: CoachMonthlyReportRecord[]
  initialSessionAssignments?: SessionAssignment[]
  initialSessionOccurrences?: TrainingSessionOccurrence[]
  initialSessionSeries?: TrainingSessionSeries[]
  initialTrainingProfiles?: PlayerTrainingProfile[]
}) {
  const router = useRouter()
  const [attendanceAdjustments, setAttendanceAdjustments] = useState(initialAttendanceAdjustments)
  const [attendanceRecords, setAttendanceRecords] = useState(initialAttendanceRecords)
  const [sessionAssignments, setSessionAssignments] = useState(initialSessionAssignments)
  const [sessionOccurrences, setSessionOccurrences] = useState(initialSessionOccurrences)
  const [sessionSeries, setSessionSeries] = useState(initialSessionSeries)
  const [members, setMembers] = useState(initialMembers)
  const [reports, setReports] = useState(initialReports)
  const [trainingProfiles, setTrainingProfiles] = useState(initialTrainingProfiles)
  const players = useMemo(
    () => joinPlayerMembers(members, trainingProfiles),
    [members, trainingProfiles],
  )
  const activePlayers = useMemo(
    () => players.filter((player) => player.training.status === "active"),
    [players],
  )

  // Server refreshes reconcile academy data without remounting the workspace.
  // Local drafts live in their editing surfaces and therefore survive an
  // unrelated successful save elsewhere on the same page.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAttendanceAdjustments(initialAttendanceAdjustments)
      setAttendanceRecords(initialAttendanceRecords)
      setMembers(initialMembers)
      setReports(initialReports)
      setSessionAssignments(initialSessionAssignments)
      setSessionOccurrences(initialSessionOccurrences)
      setSessionSeries(initialSessionSeries)
      setTrainingProfiles(initialTrainingProfiles)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [
    initialAttendanceAdjustments,
    initialAttendanceRecords,
    initialMembers,
    initialReports,
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

  const createSessionSeries = useCallback(async (input: CreateSessionSeriesInput) => {
    const result = await createSessionSeriesAction(input)
    if (!result.ok) return result
    const created = result.data
    setSessionAssignments(created.sessionAssignments)
    setSessionOccurrences(created.sessionOccurrences)
    setSessionSeries(created.sessionSeries)
    return result
  }, [])

  const assignSession = useCallback(async (input: {
    effectiveFrom: string
    playerId: string
    seriesId: string
    weekdays: number[]
  }) => {
    const result = await assignSessionAction(input)
    if (!result.ok) return result
    const snapshot = result.data
    setSessionAssignments(snapshot.sessionAssignments)
    setSessionOccurrences(snapshot.sessionOccurrences)
    setSessionSeries(snapshot.sessionSeries)
    router.refresh()
    return result
  }, [router])

  const endSession = useCallback(async (input: {
    assignmentId: string
    effectiveTo: string
  }) => {
    const result = await endSessionAssignmentAction(input)
    if (!result.ok) return result
    const snapshot = result.data
    setSessionAssignments(snapshot.sessionAssignments)
    setSessionOccurrences(snapshot.sessionOccurrences)
    setSessionSeries(snapshot.sessionSeries)
    router.refresh()
    return result
  }, [router])

  const endSeries = useCallback(async (seriesId: string) => {
    const result = await endSessionSeriesAction(seriesId)
    if (!result.ok) return result
    const snapshot = result.data
    setSessionAssignments(snapshot.sessionAssignments)
    setSessionOccurrences(snapshot.sessionOccurrences)
    setSessionSeries(snapshot.sessionSeries)
    router.refresh()
    return result
  }, [router])

  const cancelOccurrence = useCallback(async (occurrenceId: string) => {
    const result = await cancelSessionOccurrenceAction(occurrenceId)
    if (!result.ok) return result
    const snapshot = result.data
    setSessionAssignments(snapshot.sessionAssignments)
    setSessionOccurrences(snapshot.sessionOccurrences)
    setSessionSeries(snapshot.sessionSeries)
    return result
  }, [])

  const replaceOccurrence = useCallback(async (input: {
    occurrenceId: string
    dateKey: string
    startTime: string
    durationMinutes: number
    venue: string
  }) => {
    const result = await replaceSessionOccurrenceAction(input)
    if (!result.ok) return result
    const snapshot = result.data
    setSessionAssignments(snapshot.sessionAssignments)
    setSessionOccurrences(snapshot.sessionOccurrences)
    setSessionSeries(snapshot.sessionSeries)
    return result
  }, [])

  const saveReportDraft = useCallback(async (input: SaveReportDraftInput) => {
    const result = await saveReportDraftAction(input)
    if (result.ok) {
      setReports((current) => replaceReport(current, result.report))
    }
    return result
  }, [])

  const publishReport = useCallback(async (input: PublishReportInput) => {
    const result = await publishReportAction(input)
    if (result.ok) {
      setReports((current) => replaceReport(current, result.report))
      router.refresh()
    }
    return result
  }, [router])

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
    assignSession,
    cancelSessionOccurrence: cancelOccurrence,
    createSessionSeries,
    endSessionAssignment: endSession,
    endSessionSeries: endSeries,
    replaceSessionOccurrence: replaceOccurrence,
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  }), [
    assignSession,
    cancelOccurrence,
    createSessionSeries,
    endSeries,
    endSession,
    replaceOccurrence,
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
  ])
  const reportValue = useMemo<ReportPortalContextValue>(() => ({
    publishReport,
    reports,
    saveReportDraft,
  }), [publishReport, reports, saveReportDraft])

  return (
    <MemberPortalContext.Provider value={memberValue}>
      <AttendancePortalContext.Provider value={attendanceValue}>
        <SessionPortalContext.Provider value={sessionValue}>
          <ReportPortalContext.Provider value={reportValue}>
            {children}
          </ReportPortalContext.Provider>
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

export function useReportPortal() {
  return useRequiredContext(ReportPortalContext, "useReportPortal")
}

export function useMemberDirectoryPortal() {
  const memberContext = useMemberPortal()
  const sessionContext = useSessionPortal()
  const players = memberContext.players.filter(
    (player): player is PlayerMemberRecord => isAcademyMember(player.member),
  )

  if (players.length !== memberContext.players.length) {
    throw new Error("Member Directory requires complete private member records")
  }

  return {
    ...memberContext,
    ...sessionContext,
    activePlayers: players.filter((player) => player.training.status === "active"),
    players,
  }
}
