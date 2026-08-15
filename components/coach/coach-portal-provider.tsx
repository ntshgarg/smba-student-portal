"use client"

import { useRouter } from "next/navigation"
import { createContext, useContext, useEffect, useMemo, useState } from "react"

import {
  publishAttendanceAdjustmentAction,
  voidAttendanceAdjustmentAction,
} from "@/app/coach/attendance/adjustments/actions"
import {
  assignSessionAction,
  archiveMemberAction,
  approveRegistrationAction,
  cancelSessionOccurrenceAction,
  createSessionSeriesAction,
  endSessionAssignmentAction,
  endSessionSeriesAction,
  publishReportAction,
  rejectRegistrationAction,
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
  PendingRegistration,
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

type ApprovalResult = {
  academyId: string
  fullName: string
  role: "player" | "coach"
}

type CoachPortalContextValue = {
  activePlayers: OperationalPlayerMemberRecord[]
  attendanceAdjustments: AttendanceAdjustmentRecord[]
  attendanceRecords: SessionAttendanceRecords
  sessionAssignments: SessionAssignment[]
  sessionOccurrences: TrainingSessionOccurrence[]
  sessionSeries: TrainingSessionSeries[]
  pendingRegistrations: PendingRegistration[]
  players: OperationalPlayerMemberRecord[]
  reports: CoachMonthlyReportRecord[]
  approveRegistration: (
    registrationId: string,
  ) => Promise<OperationalActionResult<ApprovalResult>>
  assignSession: (input: {
    effectiveFrom: string
    playerId: string
    seriesId: string
    weekdays: number[]
  }) => Promise<OperationalActionResult<ReturnTypeSnapshot>>
  archiveMember: (input: ArchiveMemberInput) => Promise<ArchiveMemberResult>
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
  saveAttendanceRegister: (
    changes: SessionAttendanceChange[],
  ) => Promise<OperationalActionResult<{ applied: number }>>
  publishReport: (input: PublishReportInput) => Promise<ReportMutationResult>
  publishAttendanceAdjustment: (input: {
    completionOccurrenceId: string
    playerId: string
    reason?: string
    sourceOccurrenceId: string
  }) => Promise<OperationalActionResult<AttendanceAdjustmentRecord>>
  rejectRegistration: (
    registrationId: string,
  ) => Promise<OperationalActionResult<null>>
  saveMember: (input: UpdateMemberInput) => Promise<MemberMutationResult>
  saveReportDraft: (input: SaveReportDraftInput) => Promise<ReportMutationResult>
  voidAttendanceAdjustment: (
    adjustmentId: string,
  ) => Promise<OperationalActionResult<AttendanceAdjustmentRecord>>
}

type ReturnTypeSnapshot = {
  sessionAssignments: SessionAssignment[]
  sessionOccurrences: TrainingSessionOccurrence[]
  sessionSeries: TrainingSessionSeries[]
}

type CreatedSessionSnapshot = ReturnTypeSnapshot & { createdSeriesId: string }

const CoachPortalContext = createContext<CoachPortalContextValue | null>(null)

const EMPTY_ATTENDANCE_ADJUSTMENTS: AttendanceAdjustmentRecord[] = []
const EMPTY_ATTENDANCE_RECORDS: SessionAttendanceRecords = {}
const EMPTY_MEMBERS: OperationalAcademyMember[] = []
const EMPTY_PENDING_REGISTRATIONS: PendingRegistration[] = []
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
  initialPendingRegistrations = EMPTY_PENDING_REGISTRATIONS,
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
  initialPendingRegistrations?: PendingRegistration[]
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
  const [pendingRegistrations, setPendingRegistrations] = useState(initialPendingRegistrations)
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
      setPendingRegistrations(initialPendingRegistrations)
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
    initialPendingRegistrations,
    initialReports,
    initialSessionAssignments,
    initialSessionOccurrences,
    initialSessionSeries,
    initialTrainingProfiles,
  ])

  async function approveRegistration(registrationId: string) {
    const result = await approveRegistrationAction(registrationId)
    if (!result.ok) return result
    setPendingRegistrations((current) => current.filter((item) => item.id !== registrationId))
    router.refresh()
    return result
  }

  async function rejectRegistration(registrationId: string) {
    const result = await rejectRegistrationAction(registrationId)
    if (!result.ok) return result
    setPendingRegistrations((current) => current.filter((item) => item.id !== registrationId))
    router.refresh()
    return result
  }

  async function saveAttendanceRegister(
    changes: SessionAttendanceChange[],
  ) {
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
  }

  async function publishAttendanceAdjustment(input: {
    completionOccurrenceId: string
    playerId: string
    reason?: string
    sourceOccurrenceId: string
  }) {
    const result = await publishAttendanceAdjustmentAction(input)
    if (!result.ok) return result
    const published = result.data
    setAttendanceAdjustments((current) => [
      published,
      ...current.filter((item) => item.id !== published.id),
    ])
    router.refresh()
    return result
  }

  async function voidAdjustment(adjustmentId: string) {
    const result = await voidAttendanceAdjustmentAction(adjustmentId)
    if (!result.ok) return result
    const voided = result.data
    setAttendanceAdjustments((current) => current.map((item) => (
      item.id === voided.id ? voided : item
    )))
    router.refresh()
    return result
  }

  async function createSessionSeries(input: CreateSessionSeriesInput) {
    const result = await createSessionSeriesAction(input)
    if (!result.ok) return result
    const created = result.data
    setSessionAssignments(created.sessionAssignments)
    setSessionOccurrences(created.sessionOccurrences)
    setSessionSeries(created.sessionSeries)
    return result
  }

  async function assignSession(input: {
    effectiveFrom: string
    playerId: string
    seriesId: string
    weekdays: number[]
  }) {
    const result = await assignSessionAction(input)
    if (!result.ok) return result
    const snapshot = result.data
    setSessionAssignments(snapshot.sessionAssignments)
    setSessionOccurrences(snapshot.sessionOccurrences)
    setSessionSeries(snapshot.sessionSeries)
    router.refresh()
    return result
  }

  async function endSession(input: {
    assignmentId: string
    effectiveTo: string
  }) {
    const result = await endSessionAssignmentAction(input)
    if (!result.ok) return result
    const snapshot = result.data
    setSessionAssignments(snapshot.sessionAssignments)
    setSessionOccurrences(snapshot.sessionOccurrences)
    setSessionSeries(snapshot.sessionSeries)
    router.refresh()
    return result
  }

  async function endSeries(seriesId: string) {
    const result = await endSessionSeriesAction(seriesId)
    if (!result.ok) return result
    const snapshot = result.data
    setSessionAssignments(snapshot.sessionAssignments)
    setSessionOccurrences(snapshot.sessionOccurrences)
    setSessionSeries(snapshot.sessionSeries)
    router.refresh()
    return result
  }

  async function cancelOccurrence(occurrenceId: string) {
    const result = await cancelSessionOccurrenceAction(occurrenceId)
    if (!result.ok) return result
    const snapshot = result.data
    setSessionAssignments(snapshot.sessionAssignments)
    setSessionOccurrences(snapshot.sessionOccurrences)
    setSessionSeries(snapshot.sessionSeries)
    return result
  }

  async function replaceOccurrence(input: {
    occurrenceId: string
    dateKey: string
    startTime: string
    durationMinutes: number
    venue: string
  }) {
    const result = await replaceSessionOccurrenceAction(input)
    if (!result.ok) return result
    const snapshot = result.data
    setSessionAssignments(snapshot.sessionAssignments)
    setSessionOccurrences(snapshot.sessionOccurrences)
    setSessionSeries(snapshot.sessionSeries)
    return result
  }

  async function saveReportDraft(input: SaveReportDraftInput) {
    const result = await saveReportDraftAction(input)
    if (result.ok) {
      setReports((current) => replaceReport(current, result.report))
    }
    return result
  }

  async function publishReport(input: PublishReportInput) {
    const result = await publishReportAction(input)
    if (result.ok) {
      setReports((current) => replaceReport(current, result.report))
      router.refresh()
    }
    return result
  }

  async function saveMember(input: UpdateMemberInput) {
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
  }

  async function archiveMember(input: ArchiveMemberInput) {
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
  }

  const value: CoachPortalContextValue = {
    activePlayers,
    assignSession,
    archiveMember,
    attendanceAdjustments,
    attendanceRecords,
    sessionAssignments,
    sessionOccurrences,
    sessionSeries,
    pendingRegistrations,
    players,
    reports,
    approveRegistration,
    cancelSessionOccurrence: cancelOccurrence,
    createSessionSeries,
    endSessionAssignment: endSession,
    endSessionSeries: endSeries,
    publishReport,
    publishAttendanceAdjustment,
    rejectRegistration,
    replaceSessionOccurrence: replaceOccurrence,
    saveMember,
    saveAttendanceRegister,
    saveReportDraft,
    voidAttendanceAdjustment: voidAdjustment,
  }

  return <CoachPortalContext.Provider value={value}>{children}</CoachPortalContext.Provider>
}

export function useCoachPortal() {
  const context = useContext(CoachPortalContext)

  if (!context) throw new Error("useCoachPortal must be used within CoachPortalProvider")
  return context
}

export function useMemberDirectoryPortal() {
  const context = useCoachPortal()
  const players = context.players.filter(
    (player): player is PlayerMemberRecord => isAcademyMember(player.member),
  )

  if (players.length !== context.players.length) {
    throw new Error("Member Directory requires complete private member records")
  }

  return {
    ...context,
    activePlayers: players.filter((player) => player.training.status === "active"),
    players,
  }
}
