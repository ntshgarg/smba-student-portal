"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import { useMemberDirectoryPortal } from "@/components/coach/coach-portal-provider"
import {
  draftFromPlayer,
  validateDraft,
  type DraftErrors,
  type MemberDraft,
} from "@/components/coach/members/directory/member-draft"
import { useMemberTraining } from "@/components/coach/members/directory/member-training-context"
import type {
  MemberEditor,
  MemberFeedback,
} from "@/components/coach/members/directory/shared"
import { buildMemberDirectoryIndex } from "@/components/coach/members/member-directory-index"
import {
  memberDirectoryCriteriaKey,
  memberDirectoryHref,
  memberDirectorySearch,
  parseMemberDirectoryCriteria,
  type MemberDirectoryCriteria,
} from "@/components/coach/members/member-directory-query"
import {
  initialMemberWindow,
  memberWindowAfterCriteriaChange,
  memberWindowAfterEditingEnds,
  memberWindowAfterReveal,
  visibleMemberCount,
} from "@/components/coach/members/member-window"
import type { ActionFeedback } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import type {
  AcademyStaffMember,
  ArchiveMemberResult,
  MemberField,
  PlayerMemberRecord,
} from "@/lib/coach/types"
import { formatDateKey, formatInr } from "@/lib/format"
import { termFinishedToMove } from "@/lib/sessions/term"
import {
  academyPlanIsValid,
  academyPlansFor,
  type AcademyPlan,
} from "@/lib/training/academy-plans"
import type { MemberScheduledChange } from "@/lib/training/member-summaries"

/**
 * How to end the fee plan Archive refused over, naming the action the record
 * actually offers (member-training-actions.tsx): Stop fees only for a player
 * with no place and nothing booked; End training while they still have a
 * place; a booked change has to be dealt with first.
 */
export function feePlanEndRoute(
  scheduled: Pick<MemberScheduledChange, "effectiveOn" | "kind" | "stopFees"> | null,
  hasPlace: boolean,
) {
  if (scheduled?.kind === "end" && scheduled.stopFees) {
    return `wait for the End training booked for ${formatDateKey(scheduled.effectiveOn, { day: "numeric", month: "short", weekday: undefined, year: "numeric" })}, which ends the player’s Fee Plan`
  }
  if (scheduled) return "cancel the booked change above, then end the player’s Fee Plan with Stop fees"
  if (hasPlace) return "end the player’s Fee Plan with End training above (Stop fees after this month)"
  return "end the player’s Fee Plan with Stop fees above"
}

export function financialCloseoutMessage(
  result: Extract<ArchiveMemberResult, { code: "FINANCIAL_CLOSEOUT_REQUIRED" }>,
  route = feePlanEndRoute(null, false),
) {
  if (result.hasOpenFeePlan && result.hasOutstandingBalance) {
    return `Resolve ${formatInr(result.outstandingPaise)} outstanding before archiving, and ${route}`
  }
  if (result.hasOpenFeePlan) {
    return `Before archiving, ${route}`
  }
  return `Resolve ${formatInr(result.outstandingPaise)} outstanding before archiving`
}

/**
 * Every piece of Member Directory state lives here rather than in the rows that
 * read it, and that is a deliberate departure from the ledger and onboarding
 * splits this directory otherwise copies. There the extracted children each own
 * their own draft, so the root became pure composition. Here one register-wide
 * machine drives the rows: `openMember` closes an open editor, `handleArchive`
 * collapses the row it archived and writes the directory notice, `endEditing`
 * reaches back into the reveal window, and one `memberFeedback` is shared
 * between the save and archive controls. Pushing any of it into a row would
 * either duplicate it per row or reintroduce it as callbacks pointing the other
 * way, so the state stays in one named machine and the rows stay presentational.
 *
 * The hook is called first and unconditionally, so the hook order React sees is
 * the order the component itself used: usePathname, useSearchParams, the two
 * portal contexts, the training summaries' context, two useMemos, twelve useStates, six useRefs, the filter
 * useMemo, useUnsavedWorkGuard, then five useEffects. All 449 statement lines
 * moved here byte for byte, indentation included, which is why that order is
 * checkable rather than asserted.
 */
export function useMemberDirectory(staff: AcademyStaffMember[] = []) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const {
    archiveMember,
    players,
    saveMember: persistMember,
    sessionAssignments,
    sessionSeries,
  } = useMemberDirectoryPortal()
  // The academy's today, read on the server with the training summaries, so a
  // schedule whose term has finished is labelled by the same clock that set
  // each player's status.
  const memberTraining = useMemberTraining()
  const today = memberTraining?.today ?? null
  const memberIndex = useMemo(
    () => buildMemberDirectoryIndex(players, sessionAssignments, sessionSeries, today),
    [players, sessionAssignments, sessionSeries, today],
  )
  const { earliestByPlayer, playerById, sessionLabelsByPlayer } = memberIndex
  const urlCriteria = useMemo(
    () => parseMemberDirectoryCriteria(searchParams),
    [searchParams],
  )
  const query = urlCriteria.query
  const { batch, level, role, status } = urlCriteria
  const requestedMemberId = searchParams.get("player")
  const deepLinkedMemberId = requestedMemberId && playerById.has(requestedMemberId)
    ? requestedMemberId
    : null
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [memberWindow, setMemberWindow] = useState(initialMemberWindow)
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(deepLinkedMemberId)
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [editingRevision, setEditingRevision] = useState<number | null>(null)
  const [revealedContacts, setRevealedContacts] = useState<Set<string>>(() => new Set())
  const [draft, setDraft] = useState<MemberDraft | null>(null)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [archivingMemberId, setArchivingMemberId] = useState<string | null>(null)
  const [directoryFeedback, setDirectoryFeedback] = useState<ActionFeedback | null>(null)
  const [memberFeedback, setMemberFeedback] = useState<MemberFeedback | null>(null)
  const memberFormRef = useRef<HTMLFormElement>(null)
  const directorySummaryRef = useRef<HTMLHeadingElement>(null)
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const contactLinkRefs = useRef(new Map<string, HTMLAnchorElement>())
  const criteriaKey = memberDirectoryCriteriaKey(urlCriteria)
  const previousCriteriaKeyRef = useRef(criteriaKey)
  const focusedDeepLinkRef = useRef(false)

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
        // "finished" is the dashboard's link to the players to move, so it
        // lists exactly the ones its count does: a term-finished player with
        // a move or an end already booked has been dealt with
        // (termFinishedToMove in lib/sessions/term.ts).
        const matchesStatus = status === "all" || (status === "finished"
          ? termFinishedToMove(
            player.training.status,
            Boolean(memberTraining?.summaries[player.member.id]?.scheduled),
            player.member.onboardingCompletedAt === null,
          )
          : player.training.status === status)
        const matchesBatch = batch === "All batches" || player.training.batch === batch
        // The role filter is the only one that can empty this list wholesale.
        // It is applied here rather than at the render so the count in the
        // heading, the reveal window and "no results" all agree.
        const matchesRole = role !== "staff"

        return player.member.id === editingMemberId
          || player.member.id === expandedMemberId
          || (matchesSearch && matchesLevel && matchesBatch && matchesStatus && matchesRole)
      })
      .sort((a, b) => a.member.fullName.localeCompare(b.member.fullName))
  }, [batch, editingMemberId, expandedMemberId, level, memberTraining, players, query, role, status])

  /*
   * Staff answer to the role filter and the search box only. Level, batch and
   * status describe training, so applying them to a coach would empty the staff
   * half the moment anyone filtered by batch -- the same silent exclusion the
   * directory just stopped doing.
   */
  const filteredStaff = useMemo(() => {
    if (role === "players") return []
    const normalizedQuery = query.trim().toLocaleLowerCase()

    return [...staff]
      .filter((member) => !normalizedQuery
        || member.fullName.toLocaleLowerCase().includes(normalizedQuery)
        || member.academyId.toLocaleLowerCase().includes(normalizedQuery))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
  }, [query, role, staff])

  /*
   * One window over both halves, not one each. Staff render after the players,
   * so the reveal counts straight through the boundary: twelve members is
   * twelve rows whether they are twelve players, or nine players and three
   * coaches. Windowing them separately would have let a directory with 99
   * players open on fifteen rows, which is what it did before this.
   */
  const directoryCount = filteredPlayers.length + filteredStaff.length
  const editingMemberIndex = editingMemberId
    ? filteredPlayers.findIndex((player) => player.member.id === editingMemberId)
    : -1
  const expandedPlayerIndex = expandedMemberId
    ? filteredPlayers.findIndex((player) => player.member.id === expandedMemberId)
    : -1
  const expandedStaffIndex = expandedMemberId
    ? filteredStaff.findIndex((member) => member.id === expandedMemberId)
    : -1
  const expandedMemberIndex = expandedStaffIndex >= 0
    ? filteredPlayers.length + expandedStaffIndex
    : expandedPlayerIndex
  const visibleCount = visibleMemberCount(
    directoryCount,
    memberWindow,
    Math.max(editingMemberIndex, expandedMemberIndex),
  )
  const visiblePlayers = filteredPlayers.slice(0, visibleCount)
  const visibleStaff = filteredStaff.slice(
    0,
    Math.max(0, visibleCount - filteredPlayers.length),
  )
  const hasMoreMembers = visiblePlayers.length + visibleStaff.length < directoryCount

  const editingPlayer = editingMemberId
    ? playerById.get(editingMemberId) ?? null
    : null
  const isDirty = Boolean(editingPlayer && draft
    && JSON.stringify(draft) !== JSON.stringify(draftFromPlayer(editingPlayer)))
  const { confirmNavigation } = useUnsavedWorkGuard({
    isDirty,
    message: "Discard the unsaved changes to this member?",
    scope: "coach-member-editor",
  })
  // Level, batch and status do nothing for staff, so staff-only counts the role alone.
  const activeFilterCount = Number(role !== "everyone") + (role === "staff" ? 0
    : Number(level !== "All levels") + Number(status !== "all") + Number(batch !== "All batches"))
  const hasDirectoryCriteria = Boolean(query.trim()) || activeFilterCount > 0

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
    if (!requestedMemberId || deepLinkedMemberId) return
    const parameters = new URLSearchParams(window.location.search)
    parameters.delete("player")
    window.history.replaceState(null, "", memberDirectoryHref(pathname, parameters.toString()))
  }, [deepLinkedMemberId, pathname, requestedMemberId])

  useEffect(() => {
    if (!deepLinkedMemberId
      || expandedMemberId !== deepLinkedMemberId
      || focusedDeepLinkRef.current) return
    const frame = window.requestAnimationFrame(() => {
      const heading = document.getElementById(`member-details-title-${deepLinkedMemberId}`)
      if (!heading) return
      focusedDeepLinkRef.current = true
      heading.focus({ preventScroll: true })
      heading.scrollIntoView({ block: "center", behavior: "auto" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [deepLinkedMemberId, expandedMemberId])

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
      visiblePlayers.length + visibleStaff.length,
      directoryCount,
    ))
  }

  function endEditing() {
    setEditingMemberId(null)
    setMemberWindow(memberWindowAfterEditingEnds)
  }

  // Asks about any unfinished work on the record: the edit form or a training or fee form.
  function canDiscardChanges() {
    return confirmNavigation()
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
      const parameters = new URLSearchParams(window.location.search)
      parameters.delete("player")
      window.history.replaceState(null, "", memberDirectoryHref(pathname, parameters.toString()))
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
    const parameters = new URLSearchParams(window.location.search)
    parameters.set("player", memberId)
    window.history.replaceState(null, "", memberDirectoryHref(pathname, parameters.toString()))
  }

  function beginEditing(player: PlayerMemberRecord) {
    if (!canDiscardChanges()) return
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
    setMemberFeedback(null)
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

    setIsSaving(true)
    setMemberFeedback(null)
    try {
      const result = await persistMember({
        memberId: player.member.id,
        expectedRevision: editingRevision,
        profile: {
          fullName: draft.fullName,
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
      restoreEditFocus(player.member.id)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "Your edits are still on screen",
        subject: "The member update",
      })
      setMemberFeedback({
        action: failure.signIn,
        memberId: player.member.id,
        message: failure.message,
        offerRetry: failure.offerRetry,
        retryAction: "save",
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
            message: financialCloseoutMessage(result, feePlanEndRoute(
              memberTraining?.summaries[player.member.id]?.scheduled ?? null,
              sessionAssignments.some((assignment) => (
                assignment.playerId === player.member.id && assignment.effectiveTo === null
              )),
            )),
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
      const failure = describeSaveFailure({
        error,
        retained: "The member is still active",
        unconfirmed: "Check the connection, then reload the page to see whether the member was archived",
        subject: "The member archive",
      })
      setMemberFeedback({
        action: failure.signIn,
        memberId: player.member.id,
        message: failure.message,
        offerRetry: failure.offerRetry,
        retryAction: "archive",
        tone: "error",
      })
    } finally {
      setArchivingMemberId(null)
    }
  }

  // The staff list is server data, so the archived coach's row leaves when the
  // page refreshes; this closes it and says what happened in the meantime.
  function noteStaffArchived(staffMember: AcademyStaffMember) {
    setExpandedMemberId(null)
    setDirectoryFeedback({
      message: `${staffMember.fullName} archived and their sign-in switched off`,
      tone: "success",
    })
    focusAfterRender(() => directorySummaryRef.current)
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

  function revealContact(memberId: string) {
    setRevealedContacts((current) => new Set(current).add(memberId))
    focusAfterRender(() => contactLinkRefs.current.get(memberId))
  }

  function resetFilters() {
    updateDirectoryCriteria({
      query: "",
      level: "All levels",
      batch: "All batches",
      role: "everyone",
      status: "all",
    }, "push")
    setFiltersOpen(false)
  }

  const editor: MemberEditor = {
    errors,
    formRef: memberFormRef,
    isDirty,
    isSaving,
    onCancel: cancelEditing,
    onSave: saveMember,
    onSelectBatch: selectBatch,
    onSelectLevel: selectLevel,
    onUpdateField: updateDraftField,
  }

  return {
    activeFilterCount,
    archivingMemberId,
    directoryCount,
    filteredStaff,
    role,
    visibleStaff,
    beginEditing,
    directoryFeedback,
    directorySummaryRef,
    draft,
    earliestByPlayer,
    editingMemberId,
    editor,
    expandedMemberId,
    filteredPlayers,
    filtersOpen,
    handleArchive,
    hasDirectoryCriteria,
    hasMoreMembers,
    memberFeedback,
    noteStaffArchived,
    openMember,
    players,
    resetFilters,
    revealContact,
    revealMoreMembers,
    revealedContacts,
    sessionLabelsByPlayer,
    setContactLinkRef,
    setEditButtonRef,
    setFiltersOpen,
    updateDirectoryCriteria,
    urlCriteria,
    visiblePlayers,
  }
}
