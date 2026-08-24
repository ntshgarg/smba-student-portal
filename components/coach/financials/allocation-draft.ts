export type AllocationLimit = {
  id: string
  availablePaise: number
}

export type AllocationDraftResult =
  | {
      ok: true
      allocations: Array<{ id: string; amountPaise: number }>
      totalPaise: number
    }
  | {
      ok: false
      fieldId?: string
      message: string
      totalPaise: number
    }

export function paiseToRupeesInput(paise: number) {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2)
}

export function parseRupeesToPaise(value: string, allowZero = false) {
  const normalized = value.trim().replace(/,/gu, "")
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(normalized)) return null
  const [rupees, paise = ""] = normalized.split(".")
  const result = (Number(rupees) * 100) + Number(paise.padEnd(2, "0"))
  if (!Number.isSafeInteger(result) || result < 0 || (!allowZero && result === 0)) return null
  return result
}

export function createAllocationDraft(
  allocations: Array<{ id: string; amountPaise: number }>,
) {
  return Object.fromEntries(allocations.map((allocation) => [
    allocation.id,
    paiseToRupeesInput(allocation.amountPaise),
  ]))
}

export function validateAllocationDraft({
  expectedTotalPaise,
  limits,
  values,
}: {
  expectedTotalPaise: number
  limits: AllocationLimit[]
  values: Record<string, string>
}): AllocationDraftResult {
  const allocations: Array<{ id: string; amountPaise: number }> = []

  for (const limit of limits) {
    const amountPaise = parseRupeesToPaise(values[limit.id] ?? "0", true)
    if (amountPaise === null) {
      return {
        ok: false,
        fieldId: limit.id,
        message: "Enter a valid allocation amount",
        totalPaise: allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0),
      }
    }
    if (amountPaise > limit.availablePaise) {
      return {
        ok: false,
        fieldId: limit.id,
        message: "An allocation cannot exceed the available amount",
        totalPaise: allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0)
          + amountPaise,
      }
    }
    if (amountPaise > 0) allocations.push({ id: limit.id, amountPaise })
  }

  const totalPaise = allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0)
  if (totalPaise !== expectedTotalPaise) {
    return {
      ok: false,
      message: totalPaise < expectedTotalPaise
        ? "Allocate the complete amount before continuing"
        : "Allocated amounts exceed the amount being recorded",
      totalPaise,
    }
  }

  return { ok: true, allocations, totalPaise }
}

/**
 * Whole percent only. The stored unit stays basis points, because the column
 * and `calculateConcessionAmount` are both defined in them, but a fraction of a
 * percent is no longer accepted: it is the one input that can put a part-rupee
 * amount into a ledger otherwise denominated in whole rupees, and the academy
 * grants discounts in whole percent. 12.5% of the Rs 6,500 plan is Rs 812.50.
 */
export function parsePercentageToBasisPoints(value: string) {
  const normalized = value.trim()
  if (!/^(?:[1-9]\d?|100)$/u.test(normalized)) return null
  return Number(normalized) * 100
}
