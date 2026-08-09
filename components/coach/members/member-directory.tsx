"use client"

import {
  Archive,
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Eye,
  PencilLine,
  Phone,
  Search,
  SearchX,
  X,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"

import { useMemberDirectoryPortal } from "@/components/coach/coach-portal-provider"
import {
  initialMemberWindow,
  memberWindowAfterCriteriaChange,
  memberWindowAfterEditingEnds,
  memberWindowAfterReveal,
  memberWindowSummary,
  visibleMemberCount,
} from "@/components/coach/members/member-window"
import {
  memberDirectoryBatches,
  memberDirectoryCriteriaKey,
  memberDirectoryHref,
  memberDirectoryLevels,
  memberDirectorySearch,
  parseMemberDirectoryCriteria,
  type MemberDirectoryBatch,
  type MemberDirectoryCriteria,
  type MemberDirectoryLevel,
  type MemberDirectoryStatus,
} from "@/components/coach/members/member-directory-query"
import {
  InlineNotice,
  type ActionFeedback,
} from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { tryCopyText } from "@/lib/client/clipboard"
import type {
  ArchiveMemberResult,
  MemberField,
  PlayerMemberRecord,
} from "@/lib/coach/types"
import { isValidDateKey } from "@/lib/attendance/domain"
import { formatDateKey, formatSessionLabel } from "@/lib/format"
import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"
import {
  academyPlanIsValid,
  academyPlanLabel,
  academyPlansFor,
  type AcademyPlan,
} from "@/lib/training/academy-plans"

type MemberDraft = {
  fullName: string
  joinedAt: string
  contactName: string
  relationship: string
  phone: string
  level: TrainingProgramme | "Assessment pending"
  batch: "Weekday" | "Weekend" | "Assessment pending"
  academyPlan: AcademyPlan | null
}

type DraftErrors = Partial<Record<keyof MemberDraft, string>>
type MemberFeedback = ActionFeedback & {
  memberId: string
  recoveryHref?: string
}
type PendingQueueAction = {
  registrationId: string
  type: "approve" | "reject"
}

const relationships = ["Parent", "Guardian", "Self", "Other"]

function draftFromPlayer(player: PlayerMemberRecord): MemberDraft {
  return {
    fullName: player.member.fullName,
    joinedAt: player.member.joinedAt,
    contactName: player.member.primaryContact.name,
    relationship: player.member.primaryContact.relationship,
    phone: player.member.primaryContact.phone,
    level: player.training.level,
    batch: player.training.batch,
    academyPlan: player.training.academyPlan,
  }
}

function formatJoinedDate(value: string) {
  return formatDateKey(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    weekday: undefined,
  })
}

function formatOutstandingBalance(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100)
}

function financialCloseoutMessage(
  result: Extract<ArchiveMemberResult, { code: "FINANCIAL_CLOSEOUT_REQUIRED" }>,
) {
  if (result.hasOpenFeePlan && result.hasOutstandingBalance) {
    return `Resolve ${formatOutstandingBalance(result.outstandingPaise)} outstanding and end the player’s Fee Plan before archiving`
  }
  if (result.hasOpenFeePlan) {
    return "End the player’s Fee Plan before archiving"
  }
  return `Resolve ${formatOutstandingBalance(result.outstandingPaise)} outstanding before archiving`
}

function validateDraft(draft: MemberDraft) {
  const errors: DraftErrors = {}
  const fullName = draft.fullName.trim().replace(/\s+/gu, " ")
  const contactName = draft.contactName.trim().replace(/\s+/gu, " ")
  const relationship = draft.relationship.trim()
  const phone = draft.phone.trim()
  const phoneDigits = draft.phone.replace(/\D/gu, "")

  if (fullName.length < 2 || fullName.length > 80) {
    errors.fullName = "Enter a player name between 2 and 80 characters."
  }
  if (!isValidDateKey(draft.joinedAt)) {
    errors.joinedAt = "Choose a valid joining date."
  }
  const hasContact = Boolean(contactName || relationship || phone)
  if (hasContact) {
    if (contactName.length < 2 || contactName.length > 80) {
      errors.contactName = "Enter a contact name between 2 and 80 characters."
    }
    if (!relationships.includes(relationship)) {
      errors.relationship = "Choose Parent, Guardian, Self or Other."
    }
    if (phone.length > 32
      || phoneDigits.length < 10
      || phoneDigits.length > 15
      || !/^[+\d().\-\s]+$/u.test(phone)) {
      errors.phone = "Enter a phone number containing 10 to 15 digits."
    }
  }
  const levelPending = draft.level === "Assessment pending"
  const batchPending = draft.batch === "Assessment pending"
  if (levelPending !== batchPending) {
    errors.level = "Choose both the player’s level and batch, or leave both pending."
    errors.batch = "Choose both the player’s level and batch, or leave both pending."
  } else if (!levelPending && !academyPlanIsValid(
    draft.academyPlan,
    draft.level as TrainingProgramme,
    draft.batch as TrainingBatch,
  )) {
    errors.academyPlan = "Choose the Academy Plan this player enrolled in."
  }

  return errors
}

function completesInitialEvaluation(player: PlayerMemberRecord, draft: MemberDraft) {
  return (player.training.level === "Assessment pending"
      || player.training.batch === "Assessment pending")
    && draft.level !== "Assessment pending"
    && draft.batch !== "Assessment pending"
    && draft.academyPlan !== null
}

export function MemberDirectory() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    archiveMember,
    approveRegistration,
    pendingRegistrations,
    players,
    rejectRegistration,
    saveMember: persistMember,
    sessionAssignments,
    sessionSeries,
  } = useMemberDirectoryPortal()
  const urlCriteria = useMemo(
    () => parseMemberDirectoryCriteria(searchParams),
    [searchParams],
  )
  const query = urlCriteria.query
  const { batch, level, status } = urlCriteria
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [memberWindow, setMemberWindow] = useState(initialMemberWindow)
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null)
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [editingRevision, setEditingRevision] = useState<number | null>(null)
  const [revealedContacts, setRevealedContacts] = useState<Set<string>>(() => new Set())
  const [draft, setDraft] = useState<MemberDraft | null>(null)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [archivingMemberId, setArchivingMemberId] = useState<string | null>(null)
  const [directoryFeedback, setDirectoryFeedback] = useState<ActionFeedback | null>(null)
  const [memberFeedback, setMemberFeedback] = useState<MemberFeedback | null>(null)
  const [approvalResult, setApprovalResult] = useState<{
    academyId: string
    fullName: string
    role: "player" | "coach"
  } | null>(null)
  const [pendingQueueAction, setPendingQueueAction] = useState<PendingQueueAction | null>(null)
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle")
  const memberFormRef = useRef<HTMLFormElement>(null)
  const academyIdFieldRef = useRef<HTMLInputElement>(null)
  const academyIdCopyButtonRef = useRef<HTMLButtonElement>(null)
  const registrationQueueHeadingRef = useRef<HTMLHeadingElement>(null)
  const directorySummaryRef = useRef<HTMLHeadingElement>(null)
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const contactLinkRefs = useRef(new Map<string, HTMLAnchorElement>())
  const criteriaKey = memberDirectoryCriteriaKey(urlCriteria)
  const previousCriteriaKeyRef = useRef(criteriaKey)

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()

    return [...players]
      .filter((player) => {
        const matchesSearch = !normalizedQuery
          || player.member.fullName.toLocaleLowerCase().includes(normalizedQuery)
          || player.member.academyId.toLocaleLowerCase().includes(normalizedQuery)
          || player.member.primaryContact.name.toLocaleLowerCase().includes(normalizedQuery)
        const matchesLevel = level === "All levels"
          || player.training.level === level
        const matchesStatus = status === "all" || player.training.status === status
        const matchesBatch = batch === "All batches" || player.training.batch === batch

        return player.member.id === editingMemberId
          || (matchesSearch && matchesLevel && matchesBatch && matchesStatus)
      })
      .sort((a, b) => a.member.fullName.localeCompare(b.member.fullName))
  }, [batch, editingMemberId, level, players, query, status])

  const editingMemberIndex = editingMemberId
    ? filteredPlayers.findIndex((player) => player.member.id === editingMemberId)
    : -1
  const visibleCount = visibleMemberCount(
    filteredPlayers.length,
    memberWindow,
    editingMemberIndex,
  )
  const visiblePlayers = filteredPlayers.slice(0, visibleCount)
  const hasMoreMembers = visiblePlayers.length < filteredPlayers.length

  const editingPlayer = editingMemberId
    ? players.find((player) => player.member.id === editingMemberId) ?? null
    : null
  const isDirty = Boolean(editingPlayer && draft
    && JSON.stringify(draft) !== JSON.stringify(draftFromPlayer(editingPlayer)))
  const { confirmDiscard } = useUnsavedWorkGuard({
    isDirty,
    message: "Discard the unsaved changes to this member?",
    scope: "coach-member-editor",
  })
  const activeFilterCount = Number(level !== "All levels")
    + Number(status !== "all")
    + Number(batch !== "All batches")
  const hasDirectoryCriteria = Boolean(query.trim()) || activeFilterCount > 0
  const queueIsBusy = pendingQueueAction !== null

  useEffect(() => {
    const canonicalSearch = memberDirectorySearch(searchParams.toString(), urlCriteria)
    if (canonicalSearch === searchParams.toString()) return

    window.history.replaceState(
      null,
      "",
      memberDirectoryHref(pathname, canonicalSearch),
    )
  }, [pathname, searchParams, urlCriteria])

  useEffect(() => {
    if (criteriaKey === previousCriteriaKeyRef.current) return
    previousCriteriaKeyRef.current = criteriaKey
    setMemberWindow((current) => memberWindowAfterCriteriaChange(
      current,
      Boolean(editingMemberId),
    ))
  }, [criteriaKey, editingMemberId])

  useEffect(() => {
    if (!editingMemberId) return

    const frame = window.requestAnimationFrame(() => {
      memberFormRef.current
        ?.querySelector<HTMLInputElement>("input:not([type='hidden'])")
        ?.focus()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [editingMemberId])

  function focusAfterRender(target: () => HTMLElement | null | undefined) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => target()?.focus())
    })
  }

  function restoreEditFocus(memberId: string) {
    focusAfterRender(() => editButtonRefs.current.get(memberId))
  }

  function setEditButtonRef(memberId: string, node: HTMLButtonElement | null) {
    if (node) editButtonRefs.current.set(memberId, node)
    else editButtonRefs.current.delete(memberId)
  }

  function setContactLinkRef(memberId: string, node: HTMLAnchorElement | null) {
    if (node) contactLinkRefs.current.set(memberId, node)
    else contactLinkRefs.current.delete(memberId)
  }

  function updateDraftField<Key extends keyof MemberDraft>(
    field: Key,
    value: MemberDraft[Key],
  ) {
    setDraft((current) => current ? { ...current, [field]: value } : current)
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  function updateDirectoryCriteria(
    criteria: MemberDirectoryCriteria,
    historyMode: "push" | "replace",
  ) {
    const nextSearch = memberDirectorySearch(searchParams.toString(), criteria)
    const href = memberDirectoryHref(pathname, nextSearch)
    if (historyMode === "push" && !editingMemberId) {
      window.history.pushState(null, "", href)
    } else {
      window.history.replaceState(null, "", href)
    }
  }

  function revealMoreMembers() {
    setMemberWindow((current) => memberWindowAfterReveal(
      current,
      visiblePlayers.length,
      filteredPlayers.length,
    ))
  }

  function endEditing() {
    setEditingMemberId(null)
    setMemberWindow(memberWindowAfterEditingEnds)
  }

  function canDiscardChanges() {
    return !isDirty || confirmDiscard()
  }

  function openMember(memberId: string) {
    if (memberId === expandedMemberId) {
      if (!canDiscardChanges()) return
      setExpandedMemberId(null)
      endEditing()
      setEditingRevision(null)
      setDraft(null)
      setErrors({})
      setRevealedContacts(new Set())
      return
    }

    if (!canDiscardChanges()) return
    setExpandedMemberId(memberId)
    endEditing()
    setEditingRevision(null)
    setDraft(null)
    setErrors({})
    setMemberFeedback(null)
    setRevealedContacts(new Set())
  }

  function beginEditing(player: PlayerMemberRecord) {
    setEditingMemberId(player.member.id)
    setEditingRevision(player.training.recordRevision)
    setDraft(draftFromPlayer(player))
    setErrors({})
    setMemberFeedback(null)
  }

  function cancelEditing() {
    if (!canDiscardChanges()) return
    const memberId = editingMemberId
    endEditing()
    setEditingRevision(null)
    setDraft(null)
    setErrors({})
    if (memberId) restoreEditFocus(memberId)
  }

  async function saveMember(player: PlayerMemberRecord) {
    if (!draft || editingRevision === null || isSaving) return
    const nextErrors = validateDraft(draft)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      window.requestAnimationFrame(() => {
        memberFormRef.current
          ?.querySelector<HTMLElement>("[aria-invalid='true']")
          ?.focus()
      })
      return
    }

    const shouldContinueToAssignment = completesInitialEvaluation(player, draft)
    setIsSaving(true)
    setMemberFeedback(null)
    try {
      const result = await persistMember({
        memberId: player.member.id,
        expectedRevision: editingRevision,
        profile: {
          fullName: draft.fullName,
          joinedAt: draft.joinedAt,
          primaryContact: {
            name: draft.contactName.trim(),
            relationship: draft.contactName.trim() ? draft.relationship : "",
            phone: draft.phone.trim(),
          },
        },
        training: {
          batch: draft.batch,
          academyPlan: draft.academyPlan,
          level: draft.level,
        },
      })
      if (!result.ok) {
        const fieldMap: Partial<Record<MemberField, keyof MemberDraft>> = {
          fullName: "fullName",
          joinedAt: "joinedAt",
          "primaryContact.name": "contactName",
          "primaryContact.relationship": "relationship",
          "primaryContact.phone": "phone",
          level: "level",
          batch: "batch",
          academyPlan: "academyPlan",
        }
        const serverErrors = Object.entries(result.fieldErrors ?? {}).reduce<DraftErrors>(
          (next, [field, message]) => {
            const draftField = fieldMap[field as MemberField]
            if (draftField && message) next[draftField] = message
            return next
          },
          {},
        )
        setErrors(serverErrors)
        setMemberFeedback({
          memberId: player.member.id,
          message: result.message,
          tone: "error",
        })
        if (Object.keys(serverErrors).length) {
          focusAfterRender(() => (
            memberFormRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")
          ))
        }
        return
      }
      endEditing()
      setEditingRevision(null)
      setDraft(null)
      setErrors({})
      setMemberFeedback({
        memberId: player.member.id,
        message: "Member details saved",
        tone: "success",
      })
      if (shouldContinueToAssignment) {
        router.push(`/coach/schedules?player=${encodeURIComponent(player.member.id)}&from=evaluation`)
      } else {
        restoreEditFocus(player.member.id)
      }
    } catch (error) {
      setMemberFeedback({
        memberId: player.member.id,
        message: error instanceof Error ? error.message : "The member could not be saved",
        tone: "error",
      })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleArchive(player: PlayerMemberRecord) {
    if (archivingMemberId) return
    const confirmed = window.confirm(
      `Archive ${player.member.fullName}? Their portal access will be revoked, while attendance and reports remain preserved.`,
    )
    if (!confirmed) return

    setArchivingMemberId(player.member.id)
    setMemberFeedback(null)
    try {
      const result = await archiveMember({
        memberId: player.member.id,
        expectedRevision: player.training.recordRevision,
      })
      if (!result.ok) {
        if (result.code === "FINANCIAL_CLOSEOUT_REQUIRED") {
          setMemberFeedback({
            memberId: player.member.id,
            message: financialCloseoutMessage(result),
            recoveryHref: `/coach/financials/players/${encodeURIComponent(player.member.id)}`,
            tone: "error",
          })
          return
        }
        setMemberFeedback({
          memberId: player.member.id,
          message: result.message,
          tone: "error",
        })
        return
      }
      setExpandedMemberId(null)
      endEditing()
      setEditingRevision(null)
      setDraft(null)
      setErrors({})
      setRevealedContacts(new Set())
      setDirectoryFeedback({
        message: `${player.member.fullName} archived and portal access revoked`,
        tone: "success",
      })
      focusAfterRender(() => directorySummaryRef.current)
    } catch (error) {
      setMemberFeedback({
        memberId: player.member.id,
        message: error instanceof Error ? error.message : "The member could not be archived",
        tone: "error",
      })
    } finally {
      setArchivingMemberId(null)
    }
  }

  async function handleApproval(registrationId: string) {
    if (pendingQueueAction) return
    setPendingQueueAction({ registrationId, type: "approve" })
    setDirectoryFeedback(null)
    setCopyState("idle")
    try {
      const result = await approveRegistration(registrationId)
      if (!result.ok) {
        setDirectoryFeedback({ message: result.message, tone: "error" })
        return
      }
      const approved = result.data
      setApprovalResult(approved)
      setDirectoryFeedback({ message: `${approved.fullName} approved`, tone: "success" })
      focusAfterRender(() => academyIdCopyButtonRef.current)
    } catch (error) {
      setDirectoryFeedback({
        message: error instanceof Error ? error.message : "The registration could not be approved",
        tone: "error",
      })
    } finally {
      setPendingQueueAction(null)
    }
  }

  async function handleRejection(registrationId: string, fullName: string) {
    if (pendingQueueAction) return
    const confirmed = window.confirm(
      `Reject ${fullName}’s registration? They will need to register again before they can join the academy.`,
    )
    if (!confirmed) return

    setPendingQueueAction({ registrationId, type: "reject" })
    setDirectoryFeedback(null)
    try {
      const result = await rejectRegistration(registrationId)
      if (!result.ok) {
        setDirectoryFeedback({ message: result.message, tone: "error" })
        return
      }
      setDirectoryFeedback({ message: "Registration rejected", tone: "success" })
      focusAfterRender(() => registrationQueueHeadingRef.current)
    } catch (error) {
      setDirectoryFeedback({
        message: error instanceof Error ? error.message : "The registration could not be rejected",
        tone: "error",
      })
    } finally {
      setPendingQueueAction(null)
    }
  }

  async function copyAcademyId() {
    if (!approvalResult) return

    const copied = await tryCopyText(approvalResult.academyId, navigator.clipboard)
    if (copied) {
      setCopyState("copied")
      setDirectoryFeedback({ message: "Academy ID copied", tone: "success" })
    } else {
      setCopyState("unavailable")
      setDirectoryFeedback({
        message: "Unable to copy automatically. Select and copy the Academy ID manually",
        tone: "error",
      })
      window.requestAnimationFrame(() => {
        academyIdFieldRef.current?.focus()
        academyIdFieldRef.current?.select()
      })
    }
  }

  function planForClassification(
    nextLevel: MemberDraft["level"],
    nextBatch: MemberDraft["batch"],
    currentPlan: AcademyPlan | null,
  ) {
    if (nextLevel === "Assessment pending" || nextBatch === "Assessment pending") return null
    if (academyPlanIsValid(currentPlan, nextLevel, nextBatch)) return currentPlan
    return academyPlansFor(nextLevel, nextBatch)[0] ?? null
  }

  function selectLevel(nextLevel: MemberDraft["level"]) {
    if (!draft) return
    setDraft({
      ...draft,
      level: nextLevel,
      academyPlan: planForClassification(nextLevel, draft.batch, draft.academyPlan),
    })
    setErrors((current) => ({ ...current, level: undefined, academyPlan: undefined }))
  }

  function selectBatch(nextBatch: MemberDraft["batch"]) {
    if (!draft) return
    setDraft({
      ...draft,
      batch: nextBatch,
      academyPlan: planForClassification(draft.level, nextBatch, draft.academyPlan),
    })
    setErrors((current) => ({ ...current, batch: undefined, academyPlan: undefined }))
  }

  function sessionLabels(player: PlayerMemberRecord) {
    return sessionAssignments
      .filter((assignment) => (
        assignment.playerId === player.member.id
        && !assignment.effectiveTo
      ))
      .map((assignment) => {
        const series = sessionSeries.find((item) => item.id === assignment.seriesId)
        const dayLabel = assignment.weekdays
          .map((weekday) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday])
          .join(", ")
        const slot = series?.slots[0]
        return series ? `${formatSessionLabel({
          programme: series.programme,
          batch: series.batch,
          startTime: slot?.startTime ?? "",
          durationMinutes: slot?.durationMinutes ?? 0,
        })} · ${dayLabel}` : null
      })
      .filter((label): label is string => Boolean(label))
  }

  function revealContact(memberId: string) {
    setRevealedContacts((current) => new Set(current).add(memberId))
    focusAfterRender(() => contactLinkRefs.current.get(memberId))
  }

  function resetFilters() {
    updateDirectoryCriteria({
      query: "",
      level: "All levels",
      batch: "All batches",
      status: "all",
    }, "push")
    setFiltersOpen(false)
  }

  return (
    <div className="coach-members-directory page-shell">
      <div className="coach-members-back-row">
        <Link href="/coach">
          <ArrowLeft aria-hidden="true" /> Back to dashboard
        </Link>
      </div>

      <header className="coach-members-directory-header">
        <div>
          <span className="eyebrow">Academy roster</span>
          <h1>Member Directory</h1>
        </div>
        <p>
          A clear record of every player currently training at SMBA.
        </p>
      </header>

      <section className="coach-member-directory-panel" aria-labelledby="member-directory-title">
        <div
          className={`coach-registration-queue${!pendingRegistrations.length && !approvalResult ? " is-empty" : ""}`}
          aria-labelledby="registration-queue-title"
          aria-busy={queueIsBusy}
        >
          <div className="coach-registration-queue-heading">
            <div>
              <span>New registrations</span>
              <h2
                ref={registrationQueueHeadingRef}
                id="registration-queue-title"
                tabIndex={-1}
              >
                Awaiting approval
              </h2>
            </div>
            <strong>{pendingRegistrations.length}</strong>
          </div>

          {approvalResult ? (
            <div className="coach-registration-approved">
              <div>
                <Check aria-hidden="true" />
                <p>
                  <strong>{approvalResult.fullName} approved</strong>
                  <span>Share this Academy ID privately</span>
                  <input
                    ref={academyIdFieldRef}
                    aria-label={`${approvalResult.fullName} Academy ID`}
                    readOnly
                    value={approvalResult.academyId}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </p>
              </div>
              <button
                ref={academyIdCopyButtonRef}
                type="button"
                onClick={() => void copyAcademyId()}
              >
                {copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copyState === "copied" ? "Copied" : copyState === "unavailable" ? "Try again" : "Copy ID"}
              </button>
            </div>
          ) : null}

          {pendingRegistrations.length ? (
            <div className="coach-registration-list">
              <span className="sr-only" role="status" aria-live="polite">
                {pendingQueueAction
                  ? `${pendingQueueAction.type === "approve" ? "Approving" : "Rejecting"} registration`
                  : ""}
              </span>
              {pendingRegistrations.map((registration) => (
                <article key={registration.id}>
                  <div>
                    <strong>{registration.fullName}</strong>
                    <span>{registration.requestedRole === "coach"
                      ? "Coach request · controlled provisioning required"
                      : "Player"}</span>
                  </div>
                  <div>
                    <button
                      type="button"
                      disabled={queueIsBusy}
                      aria-label={`${pendingQueueAction?.registrationId === registration.id
                        && pendingQueueAction.type === "reject" ? "Rejecting" : "Reject"} ${registration.fullName}`}
                      onClick={() => void handleRejection(registration.id, registration.fullName)}
                    >
                      <X aria-hidden="true" /> {pendingQueueAction?.registrationId === registration.id
                        && pendingQueueAction.type === "reject" ? "Rejecting…" : "Reject"}
                    </button>
                    {registration.requestedRole === "player" ? (
                      <button
                        className="is-primary"
                        type="button"
                        disabled={queueIsBusy}
                        aria-label={`${pendingQueueAction?.registrationId === registration.id
                          && pendingQueueAction.type === "approve" ? "Approving" : "Approve"} ${registration.fullName}`}
                        onClick={() => void handleApproval(registration.id)}
                      >
                        <Check aria-hidden="true" /> {pendingQueueAction?.registrationId === registration.id
                          && pendingQueueAction.type === "approve" ? "Approving…" : "Approve"}
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="coach-registration-empty">No registrations are waiting.</p>
          )}
        </div>

        <InlineNotice
          className="coach-directory-notice"
          message={directoryFeedback?.message}
          tone={directoryFeedback?.tone}
        />

        <div className={`coach-member-directory-controls${filtersOpen ? " is-filters-open" : ""}`}>
          <label className="coach-member-search">
            <span className="sr-only">Search members or primary contacts</span>
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Search members"
              onChange={(event) => {
                const nextQuery = event.target.value
                updateDirectoryCriteria({
                  ...urlCriteria,
                  query: nextQuery,
                }, "replace")
              }}
            />
          </label>

          <button
            className="coach-member-filter-toggle"
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="coach-member-filters"
            onClick={() => setFiltersOpen((current) => !current)}
          >
            <span>
              <strong>Filters</strong>
              <small>{activeFilterCount ? `${activeFilterCount} active` : "Optional"}</small>
            </span>
            <ChevronDown aria-hidden="true" />
          </button>

          <div id="coach-member-filters" className="coach-member-filters">
            <label className="coach-member-filter">
              <span>Level</span>
              <select
                value={level}
                onChange={(event) => {
                  updateDirectoryCriteria({
                    ...urlCriteria,
                    level: event.target.value as MemberDirectoryLevel,
                  }, "push")
                }}
              >
                <option>All levels</option>
                {memberDirectoryLevels.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label className="coach-member-filter">
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => {
                  updateDirectoryCriteria({
                    ...urlCriteria,
                    status: event.target.value as MemberDirectoryStatus,
                  }, "push")
                }}
              >
                <option value="all">All members</option>
                <option value="unassigned">Unassigned</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </label>

            <label className="coach-member-filter">
              <span>Batch</span>
              <select
                value={batch}
                onChange={(event) => {
                  updateDirectoryCriteria({
                    ...urlCriteria,
                    batch: event.target.value as MemberDirectoryBatch,
                  }, "push")
                }}
              >
                <option>All batches</option>
                {memberDirectoryBatches.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="coach-member-directory-summary">
          <h2
            ref={directorySummaryRef}
            id="member-directory-title"
            aria-live="polite"
            aria-atomic="true"
            tabIndex={-1}
          >
            {memberWindowSummary(visiblePlayers.length, filteredPlayers.length)}
          </h2>
          <p>Contact details stay hidden until you need them.</p>
        </div>

        {filteredPlayers.length ? (
          <div className="coach-member-table-wrap">
            <table className="coach-member-table">
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Level</th>
                  <th scope="col">Batch</th>
                  <th scope="col">Sessions</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody id="coach-member-results">
                {visiblePlayers.map((player) => {
                  const memberId = player.member.id
                  const isExpanded = expandedMemberId === memberId
                  const isEditing = editingMemberId === memberId
                  const activeSessionLabels = sessionLabels(player)
                  const hasActiveAssignments = sessionAssignments.some((assignment) => (
                    assignment.playerId === memberId
                    && !assignment.effectiveTo
                  ))
                  const contactRevealed = revealedContacts.has(memberId)
                  const classificationLockId = `member-${memberId}-classification-lock`
                  const currentMemberFeedback = memberFeedback?.memberId === memberId
                    ? memberFeedback
                    : null

                  return (
                    <Fragment key={memberId}>
                      <tr className={isExpanded ? "is-expanded" : undefined}>
                        <th scope="row" data-label="Member">
                          <span className="coach-member-initials" aria-hidden="true">
                            {player.member.initials}
                          </span>
                          <span className="coach-member-name">
                            <strong>{player.member.fullName}</strong>
                            <small>{player.member.academyId}</small>
                            <span className="coach-member-mobile-meta">
                              <span>
                                {player.training.level} · {player.training.batch} · {academyPlanLabel(player.training.academyPlan)}
                              </span>
                              <span className={`coach-member-status is-${player.training.status}`}>
                                {player.training.status}
                              </span>
                            </span>
                          </span>
                        </th>
                        <td className="coach-member-mobile-hide" data-label="Level">{player.training.level}</td>
                        <td className="coach-member-mobile-hide" data-label="Batch">
                          <span className="coach-member-batch-plan">
                            <strong>{player.training.batch}</strong>
                            <small>{academyPlanLabel(player.training.academyPlan)}</small>
                          </span>
                        </td>
                        <td className="coach-member-mobile-hide" data-label="Sessions">
                          <span>{activeSessionLabels.length
                            ? `${activeSessionLabels.length} active`
                            : "Not assigned"}</span>
                        </td>
                        <td className="coach-member-mobile-hide" data-label="Joined">{formatJoinedDate(player.member.joinedAt)}</td>
                        <td className="coach-member-mobile-hide" data-label="Status">
                          <span className={`coach-member-status is-${player.training.status}`}>
                            {player.training.status}
                          </span>
                        </td>
                        <td className="coach-member-row-action">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-controls={`member-details-${memberId}`}
                            onClick={() => openMember(memberId)}
                          >
                            <span>{isExpanded ? "Close" : "Details"}</span>
                            <ChevronDown aria-hidden="true" />
                          </button>
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr className="coach-member-detail-row">
                          <td colSpan={7}>
                            <div id={`member-details-${memberId}`} className="coach-member-detail-panel">
                              <div className="coach-member-detail-heading">
                                <div>
                                  <span>Member record</span>
                                  <h3>{player.member.fullName}</h3>
                                  <p>{player.member.academyId} · {player.training.level}</p>
                                </div>
                                {!isEditing ? (
                                  <button
                                    ref={(node) => setEditButtonRef(memberId, node)}
                                    type="button"
                                    onClick={() => beginEditing(player)}
                                  >
                                    <PencilLine aria-hidden="true" /> Edit member
                                  </button>
                                ) : null}
                              </div>

                              {isEditing && draft ? (
                                <form
                                  ref={memberFormRef}
                                  className="coach-member-edit-form"
                                  onSubmit={(event) => {
                                    event.preventDefault()
                                    saveMember(player)
                                  }}
                                >
                                  <fieldset disabled={isSaving}>
                                    <legend>Profile</legend>
                                    <div className="coach-member-form-grid">
                                      <label>
                                        <span>Full name</span>
                                        <input
                                          id={`member-${memberId}-full-name`}
                                          type="text"
                                          maxLength={80}
                                          value={draft.fullName}
                                          aria-invalid={Boolean(errors.fullName)}
                                          aria-describedby={errors.fullName ? `member-${memberId}-full-name-error` : undefined}
                                          onChange={(event) => updateDraftField("fullName", event.target.value)}
                                        />
                                        {errors.fullName ? <small id={`member-${memberId}-full-name-error`}>{errors.fullName}</small> : null}
                                      </label>
                                      <label>
                                        <span>Joined date</span>
                                        <input
                                          id={`member-${memberId}-joined-at`}
                                          type="date"
                                          max={sessionAssignments
                                            .filter((assignment) => assignment.playerId === memberId)
                                            .map((assignment) => assignment.effectiveFrom)
                                            .sort()[0]}
                                          value={draft.joinedAt}
                                          aria-invalid={Boolean(errors.joinedAt)}
                                          aria-describedby={errors.joinedAt ? `member-${memberId}-joined-at-error` : undefined}
                                          onChange={(event) => updateDraftField("joinedAt", event.target.value)}
                                        />
                                        {errors.joinedAt ? <small id={`member-${memberId}-joined-at-error`}>{errors.joinedAt}</small> : null}
                                      </label>
                                      <label>
                                        <span>Primary contact</span>
                                        <input
                                          id={`member-${memberId}-contact-name`}
                                          type="text"
                                          maxLength={80}
                                          value={draft.contactName}
                                          aria-invalid={Boolean(errors.contactName)}
                                          aria-describedby={errors.contactName ? `member-${memberId}-contact-name-error` : undefined}
                                          onChange={(event) => updateDraftField("contactName", event.target.value)}
                                        />
                                        {errors.contactName ? <small id={`member-${memberId}-contact-name-error`}>{errors.contactName}</small> : null}
                                      </label>
                                      <label>
                                        <span>Relationship</span>
                                        <select
                                          id={`member-${memberId}-relationship`}
                                          value={draft.relationship}
                                          aria-invalid={Boolean(errors.relationship)}
                                          aria-describedby={errors.relationship ? `member-${memberId}-relationship-error` : undefined}
                                          onChange={(event) => updateDraftField("relationship", event.target.value)}
                                        >
                                          <option value="">Not added</option>
                                          {relationships.map((item) => <option key={item}>{item}</option>)}
                                        </select>
                                        {errors.relationship ? <small id={`member-${memberId}-relationship-error`}>{errors.relationship}</small> : null}
                                      </label>
                                      <label className="is-wide">
                                        <span>Phone</span>
                                        <input
                                          id={`member-${memberId}-phone`}
                                          type="tel"
                                          maxLength={32}
                                          value={draft.phone}
                                          aria-invalid={Boolean(errors.phone)}
                                          aria-describedby={errors.phone ? `member-${memberId}-phone-error` : undefined}
                                          onChange={(event) => updateDraftField("phone", event.target.value)}
                                        />
                                        {errors.phone ? <small id={`member-${memberId}-phone-error`}>{errors.phone}</small> : null}
                                      </label>
                                    </div>
                                  </fieldset>

                                  <fieldset disabled={isSaving}>
                                    <legend>Training</legend>
                                    {hasActiveAssignments ? (
                                      <p
                                        id={classificationLockId}
                                        className="coach-member-classification-lock"
                                      >
                                        End active session assignments before changing these training details.{" "}
                                        <Link href={`/coach/schedules?player=${encodeURIComponent(memberId)}`}>
                                          Review schedules
                                        </Link>
                                      </p>
                                    ) : null}
                                    <div className="coach-member-form-grid">
                                      <label>
                                        <span>Level</span>
                                        <select
                                          id={`member-${memberId}-level`}
                                          value={draft.level}
                                          disabled={hasActiveAssignments}
                                          aria-invalid={Boolean(errors.level)}
                                          aria-describedby={[
                                            errors.level ? `member-${memberId}-level-error` : null,
                                            hasActiveAssignments ? classificationLockId : null,
                                          ].filter(Boolean).join(" ") || undefined}
                                          onChange={(event) => selectLevel(event.target.value as MemberDraft["level"])}
                                        >
                                          <option>Assessment pending</option>
                                          {memberDirectoryLevels.map((item) => <option key={item}>{item}</option>)}
                                        </select>
                                        {errors.level ? <small id={`member-${memberId}-level-error`}>{errors.level}</small> : null}
                                      </label>
                                      <label>
                                        <span>Batch</span>
                                        <select
                                          id={`member-${memberId}-batch`}
                                          value={draft.batch}
                                          disabled={hasActiveAssignments}
                                          aria-invalid={Boolean(errors.batch)}
                                          aria-describedby={[
                                            errors.batch ? `member-${memberId}-batch-error` : null,
                                            hasActiveAssignments ? classificationLockId : null,
                                          ].filter(Boolean).join(" ") || undefined}
                                          onChange={(event) => selectBatch(event.target.value as MemberDraft["batch"])}
                                        >
                                          <option>Assessment pending</option>
                                          {memberDirectoryBatches.map((item) => <option key={item}>{item}</option>)}
                                        </select>
                                        {errors.batch ? <small id={`member-${memberId}-batch-error`}>{errors.batch}</small> : null}
                                      </label>
                                      <label>
                                        <span>Academy Plan</span>
                                        <select
                                          id={`member-${memberId}-academy-plan`}
                                          value={draft.academyPlan ?? ""}
                                          disabled={hasActiveAssignments
                                            || draft.level === "Assessment pending"
                                            || draft.batch === "Assessment pending"}
                                          aria-invalid={Boolean(errors.academyPlan)}
                                          aria-describedby={[
                                            errors.academyPlan ? `member-${memberId}-academy-plan-error` : null,
                                            hasActiveAssignments ? classificationLockId : null,
                                          ].filter(Boolean).join(" ") || undefined}
                                          onChange={(event) => {
                                            updateDraftField(
                                              "academyPlan",
                                              event.target.value ? event.target.value as AcademyPlan : null,
                                            )
                                          }}
                                        >
                                          <option value="">Needs review</option>
                                          {draft.level !== "Assessment pending" && draft.batch !== "Assessment pending"
                                            ? academyPlansFor(draft.level, draft.batch).map((plan) => (
                                                <option key={plan} value={plan}>{academyPlanLabel(plan)}</option>
                                              ))
                                            : null}
                                        </select>
                                        {errors.academyPlan ? <small id={`member-${memberId}-academy-plan-error`}>{errors.academyPlan}</small> : null}
                                      </label>
                                      <div className="coach-member-form-status">
                                        <span>Status</span>
                                        <strong>{player.training.status}</strong>
                                        <small>Managed by active session assignments.</small>
                                      </div>
                                    </div>
                                  </fieldset>

                                  <div className="coach-member-form-actions">
                                    <InlineNotice
                                      className="coach-member-editor-notice"
                                      message={memberFeedback?.memberId === memberId
                                        ? memberFeedback.message
                                        : isDirty ? "Unsaved changes" : null}
                                      tone={memberFeedback?.memberId === memberId
                                        ? memberFeedback.tone
                                        : "info"}
                                    />
                                    <div className="coach-member-editor-actions">
                                      <button type="button" disabled={isSaving} onClick={cancelEditing}>Cancel</button>
                                      <button className="is-primary" type="submit" disabled={isSaving}>
                                        <Check aria-hidden="true" /> {isSaving
                                          ? "Saving…"
                                          : completesInitialEvaluation(player, draft)
                                            ? "Save & assign sessions"
                                            : "Save member"}
                                      </button>
                                    </div>
                                  </div>
                                </form>
                              ) : (
                                <div className="coach-member-detail-domains">
                                  <section aria-labelledby={`profile-${memberId}`}>
                                    <span>Profile</span>
                                    <h4 id={`profile-${memberId}`}>Member details</h4>
                                    <dl>
                                      <div>
                                        <dt>Joined</dt>
                                        <dd>{formatJoinedDate(player.member.joinedAt)}</dd>
                                      </div>
                                      <div>
                                        <dt>Academy ID</dt>
                                        <dd>{player.member.academyId}</dd>
                                      </div>
                                      <div>
                                        <dt>Primary contact</dt>
                                        <dd>
                                          {!player.member.primaryContact.phone ? (
                                            <span>Not added</span>
                                          ) : contactRevealed ? (
                                            <span
                                              id={`member-${memberId}-primary-contact`}
                                              className="coach-member-contact"
                                            >
                                              <strong>{player.member.primaryContact.name}</strong>
                                              <small>{player.member.primaryContact.relationship}</small>
                                              <a
                                                ref={(node) => setContactLinkRef(memberId, node)}
                                                href={`tel:${player.member.primaryContact.phone.replace(/\s/gu, "")}`}
                                              >
                                                <Phone aria-hidden="true" /> {player.member.primaryContact.phone}
                                              </a>
                                            </span>
                                          ) : (
                                            <button
                                              className="coach-member-contact-reveal"
                                              type="button"
                                              aria-controls={`member-${memberId}-primary-contact`}
                                              aria-label={`Reveal primary contact for ${player.member.fullName}`}
                                              onClick={() => revealContact(memberId)}
                                            >
                                              <Eye aria-hidden="true" /> Tap to reveal
                                            </button>
                                          )}
                                        </dd>
                                      </div>
                                    </dl>
                                  </section>

                                  <section aria-labelledby={`training-${memberId}`}>
                                    <span>Training</span>
                                    <h4 id={`training-${memberId}`}>Current programme</h4>
                                    <dl>
                                      <div><dt>Level</dt><dd>{player.training.level}</dd></div>
                                      <div><dt>Batch</dt><dd>{player.training.batch}</dd></div>
                                      <div><dt>Academy Plan</dt><dd>{academyPlanLabel(player.training.academyPlan)}</dd></div>
                                      <div><dt>Status</dt><dd>{player.training.status}</dd></div>
                                      <div className="is-wide">
                                        <dt>Active sessions</dt>
                                        <dd>{activeSessionLabels.length
                                          ? activeSessionLabels.join(" · ")
                                          : "Not assigned"}</dd>
                                      </div>
                                    </dl>
                                  </section>
                                </div>
                              )}

                              {!isEditing ? (
                                <div className="coach-member-access-actions">
                                  <div>
                                    <span>Member access</span>
                                    <p>{hasActiveAssignments
                                      ? "End active session assignments before archiving this member."
                                      : "Archiving revokes portal access and preserves academy history."}</p>
                                  </div>
                                  {hasActiveAssignments ? (
                                    <Link href={`/coach/schedules?player=${encodeURIComponent(memberId)}`}>
                                      Review schedules
                                    </Link>
                                  ) : currentMemberFeedback?.recoveryHref ? (
                                    <Link href={currentMemberFeedback.recoveryHref}>
                                      Open Fee Record
                                    </Link>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={archivingMemberId === memberId}
                                      onClick={() => void handleArchive(player)}
                                    >
                                      <Archive aria-hidden="true" /> {archivingMemberId === memberId
                                        ? "Archiving…"
                                        : "Archive member"}
                                    </button>
                                  )}
                                </div>
                              ) : null}

                              {!isEditing ? (
                                <InlineNotice
                                  className="coach-member-save-notice"
                                  message={currentMemberFeedback?.message ?? null}
                                  reserveSpace={false}
                                  tone={currentMemberFeedback?.tone ?? "info"}
                                />
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            {hasMoreMembers ? (
              <button
                className="coach-member-show-more"
                type="button"
                aria-controls="coach-member-results"
                onClick={revealMoreMembers}
              >
                Show more members
              </button>
            ) : null}
          </div>
        ) : (
          <div className="coach-member-empty-state">
            <SearchX aria-hidden="true" />
            <h3>{players.length ? "No matching members" : "No players yet"}</h3>
            <p>{players.length
              ? "Try another name or clear the current search and filters"
              : "Approved players will appear here once their academy record is ready"}</p>
            {players.length && hasDirectoryCriteria ? (
              <button type="button" onClick={resetFilters}>Clear search and filters</button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  )
}
