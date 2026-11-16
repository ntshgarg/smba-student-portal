"use client"

import {
  ArrowLeft,
  Check,
  ChevronDown,
  X,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  useEffect,
  useRef,
  useState,
} from "react"

import { initials, nameParts } from "@/components/coach/members/directory/shared"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import {
  shownTrainingStart,
  type PlayerOnboardingCase,
  type PlayerOnboardingStage,
  type PlayerOnboardingWorkspace,
} from "@/lib/coach/onboarding"
import type { TrainingSessionSeries } from "@/lib/sessions/types"
import { academyPlanLabel } from "@/lib/training/academy-plans"

import styles from "./player-onboarding-register.module.css"
import { OnboardingEditor } from "./register/onboarding-editor"
import { shortDate, shortInstant, STAGES } from "./register/shared"
import { RejectedRequests, type ExpiringRejectedRegistration } from "./rejected-requests"

function onboardingHref(
  pathname: string,
  searchParams: URLSearchParams,
  playerId: string | null,
) {
  const next = new URLSearchParams(searchParams.toString())
  if (playerId) next.set("player", playerId)
  else next.delete("player")
  const query = next.toString()
  return `${pathname}${query ? `?${query}` : ""}`
}

function pillLabel(stage: PlayerOnboardingStage) {
  return stage === "request" ? "New request" : STAGES.find((item) => item.key === stage)?.tabLabel ?? stage
}

/** The line under the name: short in the queue, fuller once the record is open. */
function caseMeta(item: PlayerOnboardingCase, open: boolean) {
  if (item.stage === "request") {
    if (!item.requestedAt) return open ? "Join request" : null
    return open
      ? `Join request · ${item.requestedRole === "coach" ? "assistant coach" : "player"} · received ${shortInstant(item.requestedAt)}`
      : `Requested ${shortInstant(item.requestedAt)}`
  }
  const trainingStart = shownTrainingStart(item)
  return [
    item.academyId,
    item.level,
    item.batch,
    open && item.academyPlan ? academyPlanLabel(item.academyPlan) : null,
    open && trainingStart ? `from ${shortDate(trainingStart)}` : null,
  ].filter(Boolean).join(" · ")
}

function nextAction(item: PlayerOnboardingCase) {
  switch (item.stage) {
    case "request":
      return [item.requestedRole === "coach" ? "Review staff request" : "Review request", "Approve or reject"]
    case "assessment":
      return ["Set level, batch and plan", "From the court assessment"]
    case "session":
      return ["Assign a schedule", item.feePlanRecorded
        ? "Fee Plan already recorded"
        : "Choose the court time"]
    case "feePlan":
      return item.feePlanRecorded
        ? ["Review existing Fee Plan", "Resolve the finance record"]
        : ["Confirm monthly fee", "Last step"]
  }
}

export function PlayerOnboardingRegister({
  financeActive,
  referenceDate,
  rejectedRequests = [],
  sessionSeries,
  workspace,
}: {
  financeActive: boolean
  referenceDate: string
  rejectedRequests?: ExpiringRejectedRegistration[]
  sessionSeries: TrainingSessionSeries[]
  workspace: PlayerOnboardingWorkspace
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get("player")
  const selectedItem = workspace.cases.find((item) => item.id === selectedId) ?? null
  const [notice, setNotice] = useState<ActionFeedback | null>(null)
  const [stageFilter, setStageFilter] = useState<PlayerOnboardingStage | null>(null)
  const previousSelectionRef = useRef<string | null>(null)
  const { summary } = workspace
  const shownCases = stageFilter
    ? workspace.cases.filter((item) => item.stage === stageFilter)
    : workspace.cases

  // A link to someone with no onboarding step left opens nothing and says why.
  const missingPlayerId = selectedId && !selectedItem ? selectedId : null

  useEffect(() => {
    if (!selectedItem) return
    const focusChanged = previousSelectionRef.current !== `${selectedItem.id}:${selectedItem.stage}`
    previousSelectionRef.current = `${selectedItem.id}:${selectedItem.stage}`
    if (!focusChanged) return
    window.requestAnimationFrame(() => {
      document.getElementById(`onboarding-editor-title-${selectedItem.id}`)?.focus({
        preventScroll: true,
      })
    })
  }, [selectedItem])

  function handleSuccess(input: {
    message: string
    remove?: boolean
  }) {
    setNotice({ message: input.message, tone: "success" })
    if (input.remove && selectedItem) {
      const currentIndex = workspace.cases.findIndex((item) => item.id === selectedItem.id)
      const nextItem = workspace.cases[currentIndex + 1] ?? workspace.cases[currentIndex - 1] ?? null
      router.replace(
        onboardingHref(pathname, new URLSearchParams(searchParams.toString()), nextItem?.id ?? null),
        { scroll: false },
      )
    }
    router.refresh()
  }

  return (
    <div className={`${styles.page} page-shell`}>
      <nav className={styles.back} aria-label="Onboarding navigation">
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </nav>

      <h1 className={styles.title}>Onboarding</h1>
      <p className={styles.sub}>
        {summary.total
          ? `${summary.total} ${summary.total === 1 ? "person needs" : "people need"} a next step`
          : "Nobody needs a next step"} · {summary.onboarded} onboarded
      </p>

      <InlineNotice
        className={styles.workspaceNotice}
        message={notice?.message}
        tone={notice?.tone}
        reserveSpace={false}
      />
      {missingPlayerId && !notice ? (
        <div className={styles.workspaceNotice}>
          <InlineNotice
            message="This player has no onboarding step left: their onboarding is finished, or their request was already handled."
            tone="info"
            reserveSpace={false}
          />
          <Link href={`/coach/members?player=${encodeURIComponent(missingPlayerId)}`}>
            Open their record in Members
          </Link>
        </div>
      ) : null}

      <div className={styles.filters} role="group" aria-label="Show people at a stage">
        <button aria-pressed={stageFilter === null} onClick={() => setStageFilter(null)} type="button">
          <b>{summary.total}</b><span>All</span>
        </button>
        {STAGES.map((stage) => {
          const count = summary[stage.summaryKey]
          return (
            <button
              key={stage.key}
              aria-pressed={stageFilter === stage.key}
              disabled={count === 0}
              onClick={() => setStageFilter(stage.key)}
              type="button"
            >
              <b>{count}</b><span>{stage.label}</span>
            </button>
          )
        })}
      </div>

      {workspace.cases.length ? (
        <ol className={styles.rows} aria-label="People needing a next step">
          {shownCases.map((item) => {
            const expanded = selectedItem?.id === item.id
            const action = nextAction(item)
            const name = nameParts(item.fullName)
            const meta = caseMeta(item, expanded)
            const href = onboardingHref(
              pathname,
              new URLSearchParams(searchParams.toString()),
              expanded ? null : item.id,
            )
            return (
              <li className={expanded ? `${styles.case} ${styles.openCase}` : styles.case} key={item.id}>
                <Link
                  className={styles.caseHead}
                  href={href}
                  scroll={false}
                  aria-expanded={expanded}
                  aria-controls={expanded ? `onboarding-editor-${item.id}` : undefined}
                >
                  <span className={styles.badge} aria-hidden="true">{initials(item.fullName)}</span>
                  <span className={styles.name}>
                    <strong>{name.first}{name.rest ? <> <em>{name.rest}</em></> : null}</strong>
                    {meta ? <small>{meta}</small> : null}
                  </span>
                  <span className={styles.step}>
                    <span className={styles.pill} data-stage={item.stage}>{pillLabel(item.stage)}</span>
                    <span className={styles.next}>
                      <strong>{action[0]}</strong>
                      <small>{action[1]}</small>
                    </span>
                  </span>
                  <span className={styles.mark} aria-hidden="true">{expanded ? <X /> : <ChevronDown />}</span>
                  <span className="sr-only">{expanded ? "Close" : "Open"}</span>
                </Link>
                {expanded ? (
                  <OnboardingEditor
                    key={`${item.id}:${item.stage}:${item.recordRevision ?? "request"}`}
                    financeActive={financeActive}
                    item={item}
                    onSuccess={handleSuccess}
                    referenceDate={referenceDate}
                    sessionSeries={sessionSeries}
                  />
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : (
        <div className={styles.emptyState}>
          <Check aria-hidden="true" />
          <h2>Academy onboarding is complete.</h2>
          <p>New staff or player requests and incomplete player setup steps will appear here.</p>
          <Link href="/coach/members">Open Member Directory</Link>
        </div>
      )}

      <RejectedRequests onRestored={handleSuccess} requests={rejectedRequests} />
    </div>
  )
}
