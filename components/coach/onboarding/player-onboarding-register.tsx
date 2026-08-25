"use client"

import {
  ArrowLeft,
  ArrowRight,
  Check,
  X,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  useEffect,
  useRef,
  useState,
} from "react"

import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import type {
  PlayerOnboardingCase,
  PlayerOnboardingStage,
  PlayerOnboardingWorkspace,
} from "@/lib/coach/onboarding"
import type { TrainingSessionSeries } from "@/lib/sessions/types"

import styles from "./player-onboarding-register.module.css"
import { OnboardingEditor } from "./register/onboarding-editor"
import { folio, shortDate, STAGES } from "./register/shared"

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

function stageLabel(stage: PlayerOnboardingStage) {
  return STAGES.find((item) => item.key === stage)?.label ?? stage
}

function rowMeta(item: PlayerOnboardingCase) {
  if (item.stage === "request" && item.requestedAt) {
    return `Requested ${shortDate(item.requestedAt)}`
  }
  return [
    item.academyId,
    item.trainingStartOn ? `Training from ${shortDate(item.trainingStartOn)}` : null,
  ].filter(Boolean).join(" · ")
}

function nextAction(item: PlayerOnboardingCase) {
  switch (item.stage) {
    case "request":
      return ["Review registration", "Approve or reject the request"]
    case "assessment":
      return ["Set level, batch and plan", "Record the court assessment"]
    case "session":
      return ["Assign matching session", item.feePlanRecorded
        ? "Fee Plan is already recorded"
        : "Choose the recurring court time"]
    case "feePlan":
      return [item.feePlanRecorded ? "Review existing Fee Plan" : "Confirm monthly fee", item.feePlanRecorded
        ? "Resolve the existing finance record"
        : "Complete player onboarding"]
  }
}

export function PlayerOnboardingRegister({
  financeActive,
  referenceDate,
  sessionSeries,
  workspace,
}: {
  financeActive: boolean
  referenceDate: string
  sessionSeries: TrainingSessionSeries[]
  workspace: PlayerOnboardingWorkspace
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get("player")
  const selectedItem = workspace.cases.find((item) => item.id === selectedId) ?? null
  const [notice, setNotice] = useState<ActionFeedback | null>(null)
  const registerTitleRef = useRef<HTMLHeadingElement>(null)
  const previousSelectionRef = useRef<string | null>(null)

  useEffect(() => {
    if (selectedId && !selectedItem) {
      const firstCase = workspace.cases[0]
      router.replace(
        onboardingHref(pathname, new URLSearchParams(searchParams.toString()), firstCase?.id ?? null),
        { scroll: false },
      )
      return
    }
    if (!selectedItem) return
    const focusChanged = previousSelectionRef.current !== `${selectedItem.id}:${selectedItem.stage}`
    previousSelectionRef.current = `${selectedItem.id}:${selectedItem.stage}`
    if (!focusChanged) return
    window.requestAnimationFrame(() => {
      document.getElementById(`onboarding-editor-title-${selectedItem.id}`)?.focus({
        preventScroll: true,
      })
    })
  }, [pathname, router, searchParams, selectedId, selectedItem, workspace.cases])

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
      <div className={styles.backRow}>
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>

      <header className={styles.pageHeader}>
        <div>
          <span className="eyebrow">Academy onboarding</span>
          <h1>Academy intake register.</h1>
        </div>
        <p>One ordered queue. Approve staff access or complete the next required player step.</p>
      </header>

      <InlineNotice
        className={styles.workspaceNotice}
        message={notice?.message}
        tone={notice?.tone}
        reserveSpace={false}
      />

      <section className={styles.stageSummary} aria-label="Onboarding stage totals">
        {STAGES.map((stage) => {
          const count = workspace.summary[stage.summaryKey]
          return (
            <div
              className={selectedItem?.stage === stage.key ? styles.activeStage : ""}
              key={stage.key}
            >
              <strong aria-hidden="true">{String(count).padStart(2, "0")}</strong>
              <span className="sr-only">{count}</span>
              <p>{stage.label}</p>
            </div>
          )
        })}
      </section>

      <section className={styles.register} aria-labelledby="onboarding-register-title">
        <div className={styles.registerHeading}>
          <h2 ref={registerTitleRef} id="onboarding-register-title" tabIndex={-1}>People needing action</h2>
          <p><strong>{workspace.summary.total}</strong> in progress · Ordered by next step</p>
        </div>

        {workspace.cases.length ? (
          <ol className={styles.rows}>
            {workspace.cases.map((item, index) => {
              const expanded = selectedItem?.id === item.id
              const action = nextAction(item)
              const href = onboardingHref(
                pathname,
                new URLSearchParams(searchParams.toString()),
                expanded ? null : item.id,
              )
              return (
                <li className={expanded ? styles.expandedRow : ""} key={item.id}>
                  <div className={styles.row}>
                    <span className={styles.folio}>{folio(index)}</span>
                    <div className={styles.identity}>
                      <strong>{item.fullName}</strong>
                      <small>{rowMeta(item)}</small>
                    </div>
                    <span className={styles.stageStamp}>{stageLabel(item.stage)}</span>
                    <div className={styles.nextAction}>
                      <strong>{action[0]}</strong>
                      <small>{action[1]}</small>
                    </div>
                    <Link
                      className={styles.openButton}
                      href={href}
                      scroll={false}
                      aria-expanded={expanded}
                      aria-controls={expanded ? `onboarding-editor-${item.id}` : undefined}
                    >
                      {expanded ? "Close" : index === 0 ? "Open" : "Continue"}
                      {expanded ? <X aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                    </Link>
                  </div>
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
            <h3>Academy onboarding is complete.</h3>
            <p>New staff or player requests and incomplete player setup steps will appear here.</p>
            <Link href="/coach/members">Open Member Directory</Link>
          </div>
        )}
      </section>
    </div>
  )
}
