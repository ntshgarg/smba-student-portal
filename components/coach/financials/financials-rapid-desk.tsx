"use client"

import { ArrowLeft, ChevronDown, Search } from "lucide-react"
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
import { formatInr, getAcademyDateKey } from "@/lib/format"
import type { FinanceRapidScope, PaymentMethod } from "@/lib/finance/types"

import {
  createAllocationDraft,
  parseRupeesToPaise,
  validateAllocationDraft,
} from "./allocation-draft"
import {
  paymentMethods,
  resultFeedback,
  statusLabels,
  useIdempotencyKey,
} from "./financials-client-utils"
import styles from "./financials.module.css"
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
  if (scope === "all") params.set("scope", scope)
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
  const payableCharges = useMemo(
    () => charges.filter((charge) => charge.outstandingPaise > 0 && charge.status !== "void"),
    [charges],
  )
  const [amount, setAmount] = useState(
    payableCharges[0] ? String(payableCharges[0].outstandingPaise / 100) : "",
  )
  const [receivedOn, setReceivedOn] = useState(getAcademyDateKey())
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
        fallbackMessage: "The allocation could not be reviewed",
        retained: "The amount you entered is still on screen",
        subject: "The allocation review",
      })
      setFeedback({
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
        fallbackMessage: "The payment could not be recorded",
        retained: "The payment details are still on screen",
        subject: "The payment",
      })
      setFeedback({
        message: failure.message,
        offerRetry: failure.offerRetry,
        tone: "error",
      })
    } finally {
      setPending(null)
    }
  }

  return (
    <section className={styles.balancePaymentPanel} aria-labelledby="quick-payment-title">
      <form className={styles.balanceForm} autoComplete="off" onSubmit={(event) => void submit(event)}>
        <div className={styles.balanceEquation}>
          <div className={styles.balanceMetric}>
            <span>Outstanding</span>
            <strong>{formatInr(totalOutstandingPaise)}</strong>
            <small>Current outstanding fees</small>
          </div>

          <span className={styles.balanceOperator} aria-hidden="true">−</span>

          <label className={`${styles.balanceMetric} ${styles.balanceAmountMetric}`}>
            <span>Amount received</span>
            <span className={styles.balanceMoneyInput}>
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
            <small id="payment-amount-help">Total outstanding {formatInr(totalOutstandingPaise)}</small>
          </label>

          <span className={styles.balanceOperator} aria-hidden="true">=</span>

          <div className={`${styles.balanceMetric} ${styles.balanceProjectedMetric}`}>
            <span>Projected balance</span>
            <strong>
              {projectedBalancePaise === null || projectedBalancePaise < 0
                ? "—"
                : formatInr(projectedBalancePaise)}
            </strong>
            <small>
              {projectedBalancePaise !== null && projectedBalancePaise < 0
                ? `Exceeds balance by ${formatInr(Math.abs(projectedBalancePaise))}`
                : "After this payment is recorded"}
            </small>
          </div>
        </div>

        <div className={styles.balanceMetadata}>
          <label className={styles.balanceField}>
            <span>Received on</span>
            <input
              name="receivedOn"
              type="date"
              max={getAcademyDateKey()}
              value={receivedOn}
              disabled={Boolean(pending)}
              onChange={(event) => {
                setReceivedOn(event.target.value)
                resetMutation()
              }}
            />
          </label>

          <label className={styles.balanceField}>
            <span>Payment method</span>
            <select
              aria-label="Offline payment method"
              name="paymentMethod"
              value={method}
              disabled={Boolean(pending)}
              onChange={(event) => {
                setMethod(event.target.value as PaymentMethod)
                resetMutation()
              }}
            >
              {paymentMethods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>

          <label className={styles.balanceField}>
            <span>Reference <em>Optional</em></span>
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

          <label className={`${styles.balanceField} ${styles.balanceNoteField}`}>
            <span>Internal note <em>Optional</em></span>
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
          <div className={styles.balanceReviewPrompt}>
            <InlineNotice
              className={styles.notice}
              id={RAPID_DESK_FEEDBACK_ID}
              message={feedback?.message}
              reserveSpace={false}
              tone={feedback?.tone}
            />
            <div>
              <span>Allocation review</span>
              <p>Review exactly how this payment will be applied.</p>
            </div>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={Boolean(pending)}
              onClick={() => void reviewAllocation()}
            >
              {pending === "preview"
                ? "Reviewing…"
                : feedback?.offerRetry ? "Review allocation again" : "Review allocation"}
            </button>
          </div>
        ) : (
          <div className={styles.balanceAllocationReview}>
            <div className={styles.balanceAllocationHeading}>
              <div>
                <span>Allocation review</span>
                <strong>{formatInr(reviewedAmountPaise)} across outstanding fees</strong>
              </div>
              <button type="button" disabled={Boolean(pending)} onClick={() => editAmount(amount)}>
                Recalculate
              </button>
            </div>

            <div className={styles.balanceAllocationRows}>
              {payableCharges.map((charge) => (
                <label key={charge.id} className={styles.balanceAllocationRow}>
                  <span>
                    <strong>{charge.description}</strong>
                    <small>{charge.feeReference} · Available {formatInr(charge.outstandingPaise)}</small>
                  </span>
                  <span className={styles.balanceAllocationInput}>
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

            <div className={styles.balancePaymentFooter}>
              <InlineNotice
                className={styles.notice}
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
              <div className={styles.balanceAllocationTotal}>
                <span>Allocated</span>
                <strong>
                  {formatInr(allocationValidation?.totalPaise ?? 0)} of {formatInr(reviewedAmountPaise)}
                </strong>
              </div>
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={Boolean(pending) || !allocationValidation?.ok}
              >
                {pending === "record"
                  ? "Recording…"
                  : feedback?.offerRetry ? "Record payment again" : "Record payment"}
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
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
  const [resultsExpanded, setResultsExpanded] = useState(Boolean(initialQuery))
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
    setResultsExpanded(true)
    navigate(rapidDeskHref({ query, scope: workspace.scope }))
  }

  function readyForNextPlayer(message: string) {
    setCompletionFeedback({ message, tone: "success" })
    setQuery("")
    setResultsExpanded(true)
    router.replace(rapidDeskHref({ query: "", scope: workspace.scope }))
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  return (
    <div className={`${styles.workspace} page-shell`}>
      <div className={styles.backRow}>
        <Link href={workspace.selectedLedger ? finderHref : "/coach"}>
          <ArrowLeft aria-hidden="true" />
          {workspace.selectedLedger ? "Back to player list" : "Back to dashboard"}
        </Link>
      </div>

      <header className={`${styles.rapidDeskHeader} ${styles.balanceHeader}`}>
        <div>
          <span className="eyebrow">Financials</span>
          <h1>Record offline payment</h1>
        </div>
        <p>Find a player and record a payment the coach has already received outside the portal.</p>
      </header>

      {completionFeedback ? (
        <InlineNotice
          className={styles.rapidCompletionNotice}
          message={completionFeedback.message}
          reserveSpace={false}
          tone={completionFeedback.tone}
        />
      ) : null}

      <section
        className={workspace.selectedLedger ? styles.balanceWorkspace : styles.rapidDesk}
        aria-labelledby={workspace.selectedLedger ? "quick-payment-title" : "rapid-desk-search-title"}
      >
        {!workspace.selectedLedger ? (
          <div className={styles.rapidSearchPanel}>
            <div className={styles.rapidFinderToolbar}>
              <div className={styles.directoryHeading}>
                <span>Quick record</span>
                <h2 id="rapid-desk-search-title">Find a player</h2>
              </div>

              <div className={styles.rapidFinderControls}>
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
                  <button type="submit">Search</button>
                </form>

                <div className={styles.rapidScope} role="group" aria-label="Choose payment list">
                  {([
                    ["outstanding", "Outstanding"],
                    ["all", "All players"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={workspace.scope === value}
                      className={workspace.scope === value ? styles.activeRapidScope : undefined}
                      onClick={() => {
                        setResultsExpanded(true)
                        navigate(rapidDeskHref({
                          playerId: selectedPlayerCanPay ? selectedPlayerId ?? undefined : undefined,
                          query: initialQuery,
                          scope: value,
                        }))
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {workspace.scope === "all" ? (
                  <p className={styles.rapidScopeHelp}>
                    Only players with an outstanding registration or monthly fee can be selected.
                  </p>
                ) : null}
              </div>
            </div>

            <div className={styles.rapidResults}>
              {workspace.players.length ? (
                <>
                  <button
                    type="button"
                    className={styles.rapidResultsToggle}
                    aria-controls={resultsExpanded ? "rapid-financial-player-results" : undefined}
                    aria-expanded={resultsExpanded}
                    onClick={() => setResultsExpanded((current) => !current)}
                  >
                    <span>
                      <strong role="status">
                        {workspace.players.length} {workspace.players.length === 1 ? "player" : "players"}
                      </strong>
                      <small>
                        {workspace.scope === "outstanding" ? "With payment due" : "Current directory"}
                      </small>
                    </span>
                    <span>
                      {resultsExpanded ? "Hide list" : "Show list"}
                      <ChevronDown aria-hidden="true" />
                    </span>
                  </button>
                  {resultsExpanded ? (
                    <div id="rapid-financial-player-results">
                      <ul className={styles.playerList}>
                        {workspace.players.map((player) => {
                          const displayStatus = player.paymentEligible
                            ? statusLabels[player.status]
                            : player.hasActiveFeePlan ? statusLabels[player.status] : "Fee plan required"
                          const displayStatusClass = player.paymentEligible
                            ? styles[`status_${player.status}`]
                            : styles[player.hasActiveFeePlan
                              ? `status_${player.status}`
                              : "status_setup_required"]
                          const content = (
                            <>
                              <span className={styles.playerInitials} aria-hidden="true">
                                {player.fullName.split(/\s+/u).slice(0, 2).map((part) => part[0]).join("")}
                              </span>
                              <span>
                                <strong>{player.fullName}</strong>
                                <small>{player.academyId}</small>
                              </span>
                              <span className={styles.playerAmount}>
                                <strong>{formatInr(player.outstandingPaise)}</strong>
                                <small className={displayStatusClass}>{displayStatus}</small>
                              </span>
                            </>
                          )

                          if (!player.paymentEligible) {
                            return (
                              <li key={player.playerId}>
                                <div className={styles.staticPlayer}>{content}</div>
                              </li>
                            )
                          }

                          return (
                            <li key={player.playerId}>
                              <button
                                type="button"
                                className={selectedPlayerId === player.playerId ? styles.activePlayer : undefined}
                                aria-current={selectedPlayerId === player.playerId ? "true" : undefined}
                                onClick={() => navigate(rapidDeskHref({
                                  query: initialQuery,
                                  playerId: player.playerId,
                                  scope: workspace.scope,
                                }))}
                              >
                                {content}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : (
                <p role="status">
                  {workspace.scope === "outstanding"
                    ? "No outstanding payments match this search."
                    : "No matching players. Check the name or Academy ID and try again."}
                </p>
              )}
            </div>
          </div>
        ) : null}

        {workspace.selectedLedger ? (
          <div className={styles.balancePaymentWorkspace}>
            <div key={workspace.selectedLedger.playerId}>
              <header className={styles.balancePlayerRail}>
                <span className={styles.balancePlayerLabel}>Selected player</span>
                <div className={styles.balancePlayerIdentity}>
                  <h2 id="quick-payment-title" tabIndex={-1}>{workspace.selectedLedger.fullName}</h2>
                  <span>
                    {workspace.selectedLedger.academyId} · {statusLabels[workspace.selectedLedger.status]}
                  </span>
                </div>
                <div className={styles.balancePlayerOutstanding}>
                  <span>Outstanding</span>
                  <strong>{formatInr(workspace.selectedLedger.outstandingPaise)}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(finderHref)}
                >
                  Change player
                </button>
              </header>
              <PaymentForm
                charges={workspace.selectedLedger.charges}
                onRecorded={readyForNextPlayer}
                player={workspace.selectedLedger}
              />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
