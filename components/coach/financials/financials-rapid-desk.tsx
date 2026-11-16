"use client"

import { ArrowLeft, Search } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import type { FormEvent } from "react"

import {
  previewPaymentAllocationsAction,
  recordAllocatedPaymentAction,
} from "@/app/coach/financials/actions"
import { InlineNotice, type ActionFeedback } from "@/components/inline-notice"
import { useUnsavedWorkGuard } from "@/components/unsaved-work-guard"
import { describeSaveFailure } from "@/lib/client/network-failure"
import { formatInr, getAcademyDateKey, parseRupeesToPaise } from "@/lib/format"
import type { FinanceRapidScope, PaymentMethod } from "@/lib/finance/types"

import {
  createAllocationDraft,
  validateAllocationDraft,
} from "./allocation-draft"
import {
  paymentMethods,
  resultFeedback,
  statusLabels,
  useIdempotencyKey,
} from "./financials-client-utils"
import styles from "./fees.module.css"
import type {
  FinancialChargeView,
  PlayerFinancialLedgerView,
  RapidFinancialWorkspaceView,
} from "./types"

/**
 * `offerRetry` rides on the feedback so every existing `setFeedback(null)` also
 * withdraws the retry prompt.
 */
type SaveFeedback = ActionFeedback & { offerRetry?: boolean }

function rapidDeskHref({
  query,
  playerId,
  scope,
}: {
  query: string
  playerId?: string
  scope: FinanceRapidScope
}) {
  const params = new URLSearchParams()
  if (scope !== "outstanding") params.set("scope", scope)
  const normalizedQuery = query.trim().slice(0, 120)
  if (normalizedQuery) params.set("query", normalizedQuery)
  if (playerId) params.set("player", playerId)
  const search = params.toString()
  return `/coach/financials/record${search ? `?${search}` : ""}`
}
function PaymentForm({
  charges,
  onRecorded,
  player,
}: {
  charges: FinancialChargeView[]
  onRecorded: (message: string) => void
  player: PlayerFinancialLedgerView
}) {
  const router = useRouter()
  const payableCharges = useMemo(
    () => charges.filter((charge) => charge.outstandingPaise > 0 && charge.status !== "void"),
    [charges],
  )
  const [amount, setAmount] = useState(
    payableCharges[0] ? String(payableCharges[0].outstandingPaise / 100) : "",
  )
  const [receivedOn, setReceivedOn] = useState(getAcademyDateKey())
  // Until the coach picks a date, each new payment starts on today, so a desk
  // left open overnight does not date the next payment yesterday.
  const receivedOnChosen = useRef(false)
  const [method, setMethod] = useState<PaymentMethod>("upi")
  const [externalReference, setExternalReference] = useState("")
  const [internalNote, setInternalNote] = useState("")
  const [allocationValues, setAllocationValues] = useState<Record<string, string>>({})
  const [reviewedAmountPaise, setReviewedAmountPaise] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState<"preview" | "record" | null>(null)
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null)
  // Set when the refusal belongs to the amount box rather than to the request,
  // so the field can carry `aria-invalid` and point at the message.
  const [amountInvalid, setAmountInvalid] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)
  const requestKey = useIdempotencyKey()

  const totalOutstandingPaise = payableCharges.reduce(
    (total, charge) => total + charge.outstandingPaise,
    0,
  )
  const enteredAmountPaise = parseRupeesToPaise(amount)
  const projectedBalancePaise = enteredAmountPaise === null
    ? null
    : totalOutstandingPaise - enteredAmountPaise
  const allocationValidation = reviewedAmountPaise === null
    ? null
    : validateAllocationDraft({
        expectedTotalPaise: reviewedAmountPaise,
        limits: payableCharges.map((charge) => ({
          id: charge.id,
          availablePaise: charge.outstandingPaise,
        })),
        values: allocationValues,
      })

  useUnsavedWorkGuard({
    isDirty: dirty && pending === null,
    message: "You have an unrecorded payment. Leave without saving?",
    scope: `financial-payment-${player.playerId}`,
  })

  function resetMutation() {
    requestKey.reset()
    setFeedback(null)
    setDirty(true)
  }

  function editAmount(nextAmount: string) {
    setAmount(nextAmount)
    setAmountInvalid(false)
    setReviewedAmountPaise(null)
    setAllocationValues({})
    resetMutation()
  }

  async function reviewAllocation() {
    if (pending) return
    const amountPaise = parseRupeesToPaise(amount)
    if (amountPaise === null) {
      setFeedback({ message: "Enter a valid payment amount", tone: "error" })
      setAmountInvalid(true)
      amountRef.current?.focus()
      return
    }

    // No payment is under review yet, so nothing has been sent with this date.
    if (reviewedAmountPaise === null && !receivedOnChosen.current) {
      setReceivedOn(getAcademyDateKey())
    }
    setPending("preview")
    try {
      const result = await previewPaymentAllocationsAction({
        amountPaise,
        playerId: player.playerId,
      })
      if (!result.ok) {
        setFeedback({ message: result.message, tone: "error" })
        if (result.field === "amountPaise") {
          setAmountInvalid(true)
          amountRef.current?.focus()
        }
        return
      }
      const suggested = new Map(result.data.allocations.map((allocation) => [
        allocation.chargeId,
        allocation.amountPaise,
      ]))
      setAllocationValues(createAllocationDraft(payableCharges.map((charge) => ({
        id: charge.id,
        amountPaise: suggested.get(charge.id) ?? 0,
      }))))
      setReviewedAmountPaise(result.data.amountPaise)
      setFeedback(null)
      setDirty(true)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "The amount you entered is still on screen",
        subject: "The allocation review",
      })
      setFeedback({
        action: failure.signIn,
        message: failure.message,
        offerRetry: failure.offerRetry,
        tone: "error",
      })
    } finally {
      setPending(null)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || reviewedAmountPaise === null || !allocationValidation?.ok) {
      if (allocationValidation && !allocationValidation.ok) {
        setFeedback({ message: allocationValidation.message, tone: "error" })
        if (allocationValidation.fieldId) {
          document.getElementById(`payment-allocation-${allocationValidation.fieldId}`)?.focus()
        }
      }
      return
    }

    setPending("record")
    try {
      const result = await recordAllocatedPaymentAction({
        allocations: allocationValidation.allocations.map((allocation) => {
          const charge = payableCharges.find((item) => item.id === allocation.id)!
          return {
            amountPaise: allocation.amountPaise,
            chargeId: charge.id,
            expectedChargeRevision: charge.revision,
          }
        }),
        amountPaise: reviewedAmountPaise,
        externalReference: externalReference.trim() || undefined,
        internalNote: internalNote.trim() || undefined,
        method,
        mutationId: requestKey.current(),
        playerId: player.playerId,
        receivedOn,
      })
      if (!result.ok) {
        if (result.code === "BALANCE_CHANGED") {
          // The fees changed since the desk opened (in another tab, say). The
          // split was made against the old fees and can never be saved, so
          // load the current fees and ask for a fresh review. Recalculate
          // alone used to keep failing until the page was reloaded.
          setReviewedAmountPaise(null)
          setAllocationValues({})
          requestKey.reset()
          setFeedback({
            message: "This player's fees changed since the desk opened. The current fees are now shown. Review the allocation again.",
            tone: "error",
          })
          router.refresh()
          return
        }
        setFeedback(resultFeedback(result))
        return
      }
      requestKey.reset()
      setDirty(false)
      setAmount("")
      setExternalReference("")
      setInternalNote("")
      setAllocationValues({})
      setReviewedAmountPaise(null)
      onRecorded(result.message)
    } catch (error) {
      const failure = describeSaveFailure({
        error,
        retained: "The payment details are still on screen",
        subject: "The payment",
      })
      setFeedback({
        action: failure.signIn,
        message: failure.message,
        offerRetry: failure.offerRetry,
        tone: "error",
      })
    } finally {
      setPending(null)
    }
  }

  return (
    <form className={styles.bandBody} autoComplete="off" onSubmit={(event) => void submit(event)}>
      <label className={styles.q}>
        <span>Amount received</span>
        <span className={styles.bigAmount} data-invalid={amountInvalid ? "" : undefined}>
          <span aria-hidden="true">₹</span>
          <input
            ref={amountRef}
            name="amountReceived"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            disabled={Boolean(pending)}
            aria-invalid={amountInvalid || undefined}
            aria-describedby={amountInvalid
              ? `payment-amount-help ${RAPID_DESK_FEEDBACK_ID}`
              : "payment-amount-help"}
            onChange={(event) => editAmount(event.target.value)}
          />
        </span>
      </label>
      <p className={styles.leaves} id="payment-amount-help">
        {projectedBalancePaise === null
          ? <>Total outstanding {formatInr(totalOutstandingPaise)}</>
          : projectedBalancePaise < 0
            ? <>Exceeds balance by <b>{formatInr(Math.abs(projectedBalancePaise))}</b></>
            : <>Leaves <b>{formatInr(projectedBalancePaise)}</b> owed of {formatInr(totalOutstandingPaise)}</>}
      </p>

      <div className={`${styles.q} ${styles.dateMethod}`}>
        <label className={styles.q}>
          <span>Received on</span>
          <input
            name="receivedOn"
            type="date"
            max={getAcademyDateKey()}
            value={receivedOn}
            disabled={Boolean(pending)}
            onChange={(event) => {
              receivedOnChosen.current = true
              setReceivedOn(event.target.value)
              resetMutation()
            }}
          />
        </label>
        <fieldset className={styles.q}>
          <legend>Method</legend>
          <div className={styles.methods}>
            {paymentMethods.map((item) => (
              <label key={item.value}>
                <input
                  checked={method === item.value}
                  disabled={Boolean(pending)}
                  name="paymentMethod"
                  type="radio"
                  value={item.value}
                  onChange={() => {
                    setMethod(item.value)
                    resetMutation()
                  }}
                />
                {item.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className={`${styles.q} ${styles.two}`}>
        <label className={styles.q}>
          <span>Reference <em>(optional)</em></span>
          <input
            name="externalReference"
            value={externalReference}
            disabled={Boolean(pending)}
            placeholder="UPI or cheque reference"
            onChange={(event) => {
              setExternalReference(event.target.value)
              resetMutation()
            }}
          />
        </label>
        <label className={styles.q}>
          <span>Note <em>(staff only)</em></span>
          <textarea
            name="internalNote"
            rows={2}
            value={internalNote}
            disabled={Boolean(pending)}
            placeholder="Visible only to authorised academy staff"
            onChange={(event) => {
              setInternalNote(event.target.value)
              resetMutation()
            }}
          />
        </label>
      </div>

      {reviewedAmountPaise === null ? (
        <>
          <InlineNotice
            action={feedback?.action}
            id={RAPID_DESK_FEEDBACK_ID}
            message={feedback?.message}
            reserveSpace={false}
            tone={feedback?.tone}
          />
          <div className={styles.actions}>
            <button
              className={styles.primary}
              type="button"
              disabled={Boolean(pending)}
              onClick={() => void reviewAllocation()}
            >
              {pending === "preview"
                ? "Reviewing…"
                : feedback?.offerRetry ? "Review split again" : "Review split"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.split}>
            <div className={styles.splitHead}>
              <span>Goes to · {formatInr(reviewedAmountPaise)}</span>
              <button className={styles.plainLink} type="button" disabled={Boolean(pending)} onClick={() => editAmount(amount)}>
                Recalculate
              </button>
            </div>
            {payableCharges.map((charge) => (
              <label key={charge.id} className={styles.splitRow}>
                <span>
                  <strong>{charge.description}</strong>
                  <small>{charge.feeReference} · {formatInr(charge.outstandingPaise)} left</small>
                </span>
                <span className={styles.splitInput}>
                  <span aria-hidden="true">₹</span>
                  <input
                    id={`payment-allocation-${charge.id}`}
                    name={`allocation.${charge.id}`}
                    inputMode="decimal"
                    aria-label={`Amount allocated to ${charge.description}`}
                    value={allocationValues[charge.id] ?? "0"}
                    disabled={Boolean(pending)}
                    onChange={(event) => {
                      setAllocationValues((current) => ({
                        ...current,
                        [charge.id]: event.target.value,
                      }))
                      resetMutation()
                    }}
                  />
                </span>
              </label>
            ))}
          </div>
          <InlineNotice
            action={feedback?.action}
            message={feedback?.message ?? (
              allocationValidation && !allocationValidation.ok
                ? allocationValidation.message
                : undefined
            )}
            reserveSpace={false}
            tone={feedback?.tone ?? (
              allocationValidation && !allocationValidation.ok ? "error" : undefined
            )}
          />
          <div className={styles.actions}>
            <span className={styles.placed}>
              {formatInr(allocationValidation?.totalPaise ?? 0)} of {formatInr(reviewedAmountPaise)} placed
            </span>
            <button
              className={styles.primary}
              type="submit"
              disabled={Boolean(pending) || !allocationValidation?.ok}
            >
              {pending === "record"
                ? "Recording…"
                : feedback?.offerRetry ? "Record payment again" : "Record payment"}
            </button>
          </div>
        </>
      )}
    </form>
  )
}


/*
 * The amount box is the one money field in the product whose refusal was
 * announced and then unreachable: `role="alert"` fired once and focus moved
 * here, but the input kept `aria-describedby="payment-amount-help"` and never
 * carried `aria-invalid`, so a screen-reader user who tabbed away and back
 * heard only "Total outstanding ₹1,000" and no hint that the value was refused.
 *
 * Every other form in the tree already wires a field to its own message --
 * member-edit-form, activation-form, pin-setup-form, recovery-reset-forms. This
 * gives the desk the same wiring by naming the shared notice.
 */
const RAPID_DESK_FEEDBACK_ID = "quick-payment-feedback"

export function FinancialsRapidDesk({
  initialQuery,
  workspace,
}: {
  initialQuery: string
  workspace: RapidFinancialWorkspaceView
}) {
  const router = useRouter()
  const [query, setQuery] = useState(initialQuery.slice(0, 120))
  // Back and Forward change the address under this same screen, so the box follows it.
  const [addressQuery, setAddressQuery] = useState(initialQuery)
  if (addressQuery !== initialQuery) {
    setAddressQuery(initialQuery)
    setQuery(initialQuery.slice(0, 120))
  }
  const [completionFeedback, setCompletionFeedback] = useState<ActionFeedback | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectedPlayerId = workspace.selectedLedger?.playerId ?? null
  const selectedPlayerCanPay = workspace.players.find(
    (player) => player.playerId === selectedPlayerId,
  )?.paymentEligible ?? false
  const finderHref = rapidDeskHref({ query: initialQuery, scope: workspace.scope })
  const { confirmNavigation } = useUnsavedWorkGuard({
    isDirty: false,
    scope: "financial-rapid-desk-navigation",
  })

  useEffect(() => {
    if (!selectedPlayerId) return
    document.getElementById("quick-payment-title")?.focus({ preventScroll: true })
  }, [selectedPlayerId])

  function navigate(href: string, replace = false) {
    if (!confirmNavigation()) return
    setCompletionFeedback(null)
    if (replace) router.replace(href)
    else router.push(href)
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    navigate(rapidDeskHref({ query, scope: workspace.scope }))
  }

  function readyForNextPlayer(message: string) {
    setCompletionFeedback({ message, tone: "success" })
    setQuery("")
    router.replace(rapidDeskHref({ query: "", scope: workspace.scope }))
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  const scopes = [
    ["outstanding", "Owes money"],
    ["overdue", "Overdue"],
    ["all", "All players"],
  ] as const

  return (
    <div className={`${styles.page} page-shell`}>
      <div className={styles.back}>
        <Link href={workspace.selectedLedger ? finderHref : "/coach"}>
          <ArrowLeft aria-hidden="true" />
          {workspace.selectedLedger ? "Back to player list" : "Back to dashboard"}
        </Link>
      </div>

      <div className={styles.head}>
        <h1 className={styles.title}>Record payment</h1>
      </div>

      {completionFeedback ? (
        <InlineNotice
          message={completionFeedback.message}
          reserveSpace={false}
          tone={completionFeedback.tone}
        />
      ) : null}

      {!workspace.selectedLedger ? (
        <section className={styles.finder} aria-labelledby="rapid-desk-search-title">
          <h2 className="sr-only" id="rapid-desk-search-title">Find a player</h2>
          <div className={styles.finderTop}>
            <form className={styles.search} role="search" onSubmit={submitSearch}>
              <Search aria-hidden="true" />
              <label className="sr-only" htmlFor="rapid-financial-player-search">Search players</label>
              <input
                ref={searchInputRef}
                id="rapid-financial-player-search"
                name="q"
                type="search"
                autoComplete="off"
                maxLength={120}
                value={query}
                placeholder="Name, Academy ID or fee reference"
                onChange={(event) => setQuery(event.target.value)}
              />
            </form>
            <div className={styles.seg} role="group" aria-label="Choose payment list">
              {scopes.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={workspace.scope === value}
                  onClick={() => navigate(rapidDeskHref({
                    playerId: selectedPlayerCanPay ? selectedPlayerId ?? undefined : undefined,
                    query: initialQuery,
                    scope: value,
                  }))}
                >
                  {label}{workspace.scope === value ? ` ${workspace.players.length}` : ""}
                </button>
              ))}
            </div>
          </div>
          {workspace.scope === "all" ? (
            <p className={styles.finderNote}>
              Only players with an outstanding registration or monthly fee can be selected.
            </p>
          ) : null}

          {workspace.players.length ? (
            <p className="sr-only" role="status">
              {workspace.players.length} {workspace.players.length === 1 ? "player" : "players"}
              {workspace.scope === "outstanding"
                ? " with payment due"
                : workspace.scope === "overdue" ? " past their due date" : " in the directory"}
            </p>
          ) : null}
          {workspace.players.length ? (
            <ul className={styles.payers} id="rapid-financial-player-results">
              {workspace.players.map((player) => {
                // A player whose fee plans have all ended left or stopped
                // fees; they need no plan set up.
                const showsStatus = player.paymentEligible
                  || player.hasActiveFeePlan
                  || player.feePlanEnded
                const content = (
                  <>
                    <span className={styles.badge} aria-hidden="true">
                      {player.fullName.split(/\s+/u).slice(0, 2).map((part) => part[0]).join("")}
                    </span>
                    <span className={styles.who}>
                      <strong>{player.fullName}</strong>
                      <small>{player.academyId}</small>
                    </span>
                    <span className={styles.amount}>
                      {formatInr(player.outstandingPaise)}
                      <small data-status={showsStatus ? player.status : "setup_required"}>
                        {showsStatus ? statusLabels[player.status] : "Fee plan required"}
                      </small>
                    </span>
                  </>
                )

                if (!player.paymentEligible) {
                  return (
                    <li key={player.playerId}>
                      <div className={styles.payer}>{content}</div>
                    </li>
                  )
                }

                return (
                  <li key={player.playerId}>
                    <button
                      type="button"
                      className={styles.payer}
                      aria-current={selectedPlayerId === player.playerId ? "true" : undefined}
                      onClick={() => navigate(rapidDeskHref({
                        query: initialQuery,
                        playerId: player.playerId,
                        scope: workspace.scope,
                      }))}
                    >
                      {content}
                      <span className={styles.chev} aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className={styles.finderNote} role="status">
              {workspace.scope === "outstanding"
                ? "No outstanding payments match this search."
                : workspace.scope === "overdue"
                  ? "No overdue payments match this search."
                  : "No matching players. Check the name or Academy ID and try again."}
            </p>
          )}
        </section>
      ) : (
        <section className={styles.band} key={workspace.selectedLedger.playerId} aria-labelledby="quick-payment-title">
          <div className={`${styles.bandTop} ${styles.bandTopPad}`}>
            <div className={styles.bandHead}>
              <div>
                <h2 id="quick-payment-title" tabIndex={-1}>{workspace.selectedLedger.fullName}</h2>
                <p>{workspace.selectedLedger.academyId} · {statusLabels[workspace.selectedLedger.status]}</p>
              </div>
              <div className={styles.owe}>
                <b>{formatInr(workspace.selectedLedger.outstandingPaise)}</b>
                <span>owed</span>
              </div>
            </div>
            <div className={styles.bandActions}>
              <button className={styles.button} type="button" onClick={() => navigate(finderHref)}>
                Change player
              </button>
            </div>
          </div>
          <PaymentForm
            charges={workspace.selectedLedger.charges}
            onRecorded={readyForNextPlayer}
            player={workspace.selectedLedger}
          />
        </section>
      )}
    </div>
  )
}
