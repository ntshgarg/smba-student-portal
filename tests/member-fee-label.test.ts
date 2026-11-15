import { describe, expect, it } from "vitest"

import { thisMonthFeeLabel } from "@/components/coach/members/directory/this-month-fee-label"
import { deriveFinanceStatus } from "@/lib/finance/domain"

/*
 * Members once worked this label out on its own and showed a part-paid fee past
 * its due date as "₹X paid" while Financials called it Overdue. It now reads the
 * status Financials gives the same fee.
 */
const charge = (receivedPaise: number) => ({
  adjustments: [],
  dueDate: "2026-11-10",
  lifecycle: "issued" as const,
  originalAmountPaise: 350_000,
  payments: receivedPaise ? [{ amountPaise: receivedPaise, lifecycle: "recorded" as const }] : [],
})

function label(receivedPaise: number, today: string) {
  return thisMonthFeeLabel({
    amountPaise: 350_000,
    dueDate: "2026-11-10",
    receivedPaise,
    status: deriveFinanceStatus(charge(receivedPaise), today),
  })
}

describe("this month's fee on a player's record", () => {
  it("calls a part-paid fee past its due date overdue, as Financials does", () => {
    expect(label(100_000, "2026-11-15")).toBe("₹3,500 · overdue, was due Tue 10 Nov · ₹1,000 paid")
  })

  it("keeps the other states", () => {
    expect(label(350_000, "2026-11-15")).toBe("₹3,500 · paid")
    expect(label(100_000, "2026-11-05")).toBe("₹3,500 · ₹1,000 paid")
    expect(label(0, "2026-11-05")).toBe("₹3,500 · due Tue 10 Nov")
    expect(label(0, "2026-11-15")).toBe("₹3,500 · overdue, was due Tue 10 Nov")
  })
})
