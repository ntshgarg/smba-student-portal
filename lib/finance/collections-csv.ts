export type CollectionCsvRow = {
  academyId: string
  amountPaise: number
  coveredFeeReferences: string[]
  eventDate: string
  eventType: "payment" | "refund"
  method: string | null
  playerName: string
  reference: string
  lifecycle?: "recorded" | "reversed"
}

const COLLECTION_HEADERS = [
  "Date",
  "Event",
  "Reference",
  "Player",
  "Academy ID",
  "Method",
  "Amount (INR)",
  "Fee references",
  "Status",
] as const

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  card: "Card",
  cash: "Cash",
  cheque: "Cheque",
  other: "Other",
  upi: "UPI",
}

function neutralizeSpreadsheetFormula(value: string) {
  return /^\s*[=+\-@]/u.test(value) || /^[\t\r]/u.test(value) ? `'${value}` : value
}

function csvCell(value: string) {
  const safeValue = neutralizeSpreadsheetFormula(value)
  return /[",\r\n]/u.test(safeValue)
    ? `"${safeValue.replaceAll('"', '""')}"`
    : safeValue
}

function formatPaise(amountPaise: number) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) {
    throw new Error("Collection export contains an invalid amount.")
  }
  return `${Math.floor(amountPaise / 100)}.${String(amountPaise % 100).padStart(2, "0")}`
}

export function collectionCsvLines(rows: Iterable<CollectionCsvRow>) {
  return (function* generateLines() {
    yield `${COLLECTION_HEADERS.map(csvCell).join(",")}\r\n`
    for (const row of rows) {
      yield `${[
        row.eventDate,
        row.eventType === "payment" ? "Payment" : "Refund",
        row.reference,
        row.playerName,
        row.academyId,
        row.method ? (METHOD_LABELS[row.method] ?? row.method) : "",
        formatPaise(row.amountPaise),
        row.coveredFeeReferences.join("; "),
        row.lifecycle === "reversed" ? "Reversed" : "Recorded",
      ].map(csvCell).join(",")}\r\n`
    }
  })()
}

export function createCollectionCsvStream(rows: Iterable<CollectionCsvRow>) {
  const encoder = new TextEncoder()
  const lines = collectionCsvLines(rows)

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = lines.next()
      if (next.done) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(next.value))
    },
  })
}
