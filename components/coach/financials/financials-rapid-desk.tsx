"use client"

import { ArrowLeft, ReceiptIndianRupee, Search } from "lucide-react"
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
import { getAcademyDateKey } from "@/lib/format"
import type { FinanceRapidScope, PaymentMethod } from "@/lib/finance/types"

import {
  createAllocationDraft,
  parseRupeesToPaise,
  validateAllocationDraft,
} from "./allocation-draft"
import {
  formatInr,
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

function rapidDeskHref({
  query,
  playerId,
  scope,
}: {
  query: string
  playerId?: string
  scope: FinanceRapidScope
}) {
  const params = new URLSearchParams({ scope })
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
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const requestKey = useIdempotencyKey()

  const totalOutstandingPaise = payableCharges.reduce(
    (total, charge) => total + charge.outstandingPaise,
    0,
  )
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
    setReviewedAmountPaise(null)
    setAllocationValues({})
    resetMutation()
  }

  async function reviewAllocation() {
    if (pending) return
    const amountPaise = parseRupeesToPaise(amount)
    if (amountPaise === null) {
      setFeedback({ message: "Enter a valid payment amount", tone: "error" })
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
        if (result.field === "amountPaise") amountRef.current?.focus()
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
      setFeedback({
        message: error instanceof Error ? error.message : "The allocation could not be reviewed",
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
      setFeedback({
        message: error instanceof Error ? error.message : "The payment could not be recorded",
        tone: "error",
      })
    } finally {
      setPending(null)
    }
  }

  return (
    <section className={styles.paymentPanel} aria-labelledby="quick-payment-title">
      <div className={styles.paymentHeading}>
        <span>Quick record</span>
        <h3 id="quick-payment-title" tabIndex={-1}>Record payment</h3>
        <p>Enter one receipt, then review how it will be applied across outstanding fees.</p>
      </div>

      <form onSubmit={(event) => void submit(event)}>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Amount received</span>
            <div className={styles.moneyInput}>
              <span aria-hidden="true">₹</span>
              <input
                ref={amountRef}
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                disabled={Boolean(pending)}
                aria-describedby="payment-amount-help"
                onChange={(event) => editAmount(event.target.value)}
              />
            </div>
            <small id="payment-amount-help">Total outstanding {formatInr(totalOutstandingPaise)}</small>
          </label>
          <label className={styles.field}>
            <span>Received on</span>
            <input
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
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Payment method</span>
            <select
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
          <label className={styles.field}>
            <span>Reference <em>Optional</em></span>
            <input
              value={externalReference}
              disabled={Boolean(pending)}
              placeholder="UPI or cheque reference"
              onChange={(event) => {
                setExternalReference(event.target.value)
                resetMutation()
              }}
            />
          </label>
        </div>

        <label className={styles.field}>
          <span>Internal note <em>Optional</em></span>
          <textarea
            rows={3}
            value={internalNote}
            disabled={Boolean(pending)}
            placeholder="Visible only to authorised academy staff"
            onChange={(event) => {
              setInternalNote(event.target.value)
              resetMutation()
            }}
          />
        </label>

        {reviewedAmountPaise === null ? (
          <div className={styles.paymentFooter}>
            <InlineNotice className={styles.notice} message={feedback?.message} tone={feedback?.tone} />
            <button
              className={styles.primaryButton}
              type="button"
              disabled={Boolean(pending)}
              onClick={() => void reviewAllocation()}
            >
              {pending === "preview" ? "Reviewing…" : "Review allocation"}
            </button>
          </div>
        ) : (
          <div className={styles.allocationReview}>
            <div className={styles.allocationHeading}>
              <div>
                <span>Allocation review</span>
                <strong>{formatInr(reviewedAmountPaise)} across outstanding fees</strong>
              </div>
              <button type="button" disabled={Boolean(pending)} onClick={() => editAmount(amount)}>
                Recalculate
              </button>
            </div>

            <div className={styles.allocationRows}>
              {payableCharges.map((charge) => (
                <label key={charge.id} className={styles.allocationRow}>
                  <span>
                    <strong>{charge.description}</strong>
                    <small>{charge.feeReference} · Available {formatInr(charge.outstandingPaise)}</small>
                  </span>
                  <span className={styles.allocationInput}>
                    <span aria-hidden="true">₹</span>
                    <input
                      id={`payment-allocation-${charge.id}`}
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

            <div className={styles.allocationTotal}>
              <span>Allocated</span>
              <strong>
                {formatInr(allocationValidation?.totalPaise ?? 0)} of {formatInr(reviewedAmountPaise)}
              </strong>
            </div>

            <div className={styles.paymentFooter}>
              <InlineNotice
                className={styles.notice}
                message={feedback?.message ?? (
                  allocationValidation && !allocationValidation.ok
                    ? allocationValidation.message
                    : undefined
                )}
                tone={feedback?.tone ?? (
                  allocationValidation && !allocationValidation.ok ? "error" : undefined
                )}
              />
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={Boolean(pending) || !allocationValidation?.ok}
              >
                {pending === "record" ? "Recording…" : "Record payment"}
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  )
}


export function FinancialsRapidDesk({
  initialQuery,
  workspace,
}: {
  initialQuery: string
  workspace: RapidFinancialWorkspaceView
}) {
  const router = useRouter()
  const [query, setQuery] = useState(initialQuery.slice(0, 120))
  const [completionFeedback, setCompletionFeedback] = useState<ActionFeedback | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectedPlayerId = workspace.selectedLedger?.playerId ?? null
  const selectedPlayerCanPay = workspace.players.find(
    (player) => player.playerId === selectedPlayerId,
  )?.paymentEligible ?? false
  const { confirmNavigation } = useUnsavedWorkGuard({
    isDirty: false,
    scope: "financial-rapid-desk-navigation",
  })

  useEffect(() => {
    if (!selectedPlayerId) return
    document.getElementById("quick-payment-title")?.focus()
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

  return (
    <div className={`${styles.workspace} page-shell`}>
      <div className={styles.backRow}>
        <Link href="/coach"><ArrowLeft aria-hidden="true" /> Back to dashboard</Link>
      </div>

      <header className={styles.rapidDeskHeader}>
        <span className="eyebrow">Financials</span>
        <h1>Record payment</h1>
        <p>Find a player, review the receipt allocation and continue to the next payment.</p>
      </header>

      <section className={styles.rapidDesk} aria-labelledby="rapid-desk-search-title">
        <div className={styles.rapidSearchPanel}>
          <div className={styles.directoryHeading}>
            <span>Quick record</span>
            <h2 id="rapid-desk-search-title">Find a player</h2>
          </div>

          <form className={styles.search} role="search" onSubmit={submitSearch}>
            <Search aria-hidden="true" />
            <label className="sr-only" htmlFor="rapid-financial-player-search">Search players</label>
            <input
              ref={searchInputRef}
              id="rapid-financial-player-search"
              type="search"
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
                onClick={() => navigate(rapidDeskHref({
                  playerId: selectedPlayerCanPay ? selectedPlayerId ?? undefined : undefined,
                  query: initialQuery,
                  scope: value,
                }))}
              >
                {label}
              </button>
            ))}
          </div>
          {workspace.scope === "all" ? (
            <p className={styles.rapidScopeHelp}>
              Only players with an outstanding balance from a Fee Plan can be selected.
            </p>
          ) : null}

          <div className={styles.rapidResults}>
            {workspace.players.length ? (
              <>
                <span role="status">
                  {workspace.players.length} {workspace.players.length === 1 ? "player" : "players"}
                </span>
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

        <div className={styles.rapidPaymentPanel}>
          {completionFeedback ? (
            <InlineNotice
              className={styles.rapidCompletionNotice}
              message={completionFeedback.message}
              reserveSpace={false}
              tone={completionFeedback.tone}
            />
          ) : null}
          {workspace.selectedLedger ? (
            <div key={workspace.selectedLedger.playerId}>
              <header className={styles.rapidPlayerHeader}>
                <div>
                  <span>{workspace.selectedLedger.academyId}</span>
                  <h2>{workspace.selectedLedger.fullName}</h2>
                </div>
                <div>
                  <span>Outstanding</span>
                  <strong>{formatInr(workspace.selectedLedger.outstandingPaise)}</strong>
                </div>
              </header>
              <PaymentForm
                charges={workspace.selectedLedger.charges}
                onRecorded={readyForNextPlayer}
                player={workspace.selectedLedger}
              />
            </div>
          ) : (
            <div className={styles.rapidEmpty}>
              <ReceiptIndianRupee aria-hidden="true" />
              <span>Receipt desk</span>
              <h2>Select a player</h2>
              <p>The payment form will open here with the player’s current outstanding fees.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
