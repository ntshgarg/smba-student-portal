import path from "node:path"

import PDFDocument from "pdfkit"

import {
  formatAcademyDate,
  formatAcademyTime,
  formatDateKey,
} from "@/lib/format"
import type {
  FinanceReceiptDocument,
  FinanceStatementCharge,
  FinanceStatementDocument,
  FinanceStatementReceipt,
} from "@/lib/finance/documents"
import type {
  AdjustmentKind,
  FinanceStatus,
  PaymentMethod,
} from "@/lib/finance/types"

const NAVY = "#081c42"
const RED = "#c91f2b"
const IVORY = "#f6f3ec"
const STEEL = "#617083"
const PALE = "#ece9e1"
const WHITE = "#ffffff"
const GREEN = "#176b4d"
const AMBER = "#8a5a00"
const PAGE_MARGIN = 50
const CONTENT_BOTTOM = 758

type FinancePdf = FinanceReceiptDocument | FinanceStatementDocument

function money(amountPaise: number) {
  const amount = amountPaise / 100
  return `INR ${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: amountPaise % 100 ? 2 : 0,
    minimumFractionDigits: amountPaise % 100 ? 2 : 0,
  }).format(amount)}`
}

function dateKey(value: string) {
  return formatDateKey(value, {
    day: "numeric",
    month: "long",
    weekday: undefined,
    year: "numeric",
  })
}

function generatedLabel(value: string) {
  return `${formatAcademyDate(value)} at ${formatAcademyTime(value)}`
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  card: "Card",
  cash: "Cash",
  cheque: "Cheque",
  other: "Other",
  upi: "UPI",
}

const STATUS_LABELS: Record<FinanceStatus, string> = {
  not_prepared: "Not prepared",
  overdue: "Overdue",
  paid: "Paid",
  partially_paid: "Partially paid",
  pending: "Pending",
  setup_required: "Setup required",
  void: "Void",
}

const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  concession_credit: "Fee concession",
  manual_credit: "Credit adjustment",
  manual_debit: "Debit adjustment",
  withdrawal_credit: "Unused-training credit",
}

function statusTone(value: string) {
  if (["paid", "recorded"].includes(value)) return GREEN
  if (["pending", "partially_paid", "partially_refunded"].includes(value)) return AMBER
  if (["overdue", "reversed", "fully_refunded", "void"].includes(value)) return RED
  return STEEL
}

function receiptStatusLabel(status: FinanceReceiptDocument["status"]) {
  return {
    fully_refunded: "Fully refunded",
    partially_refunded: "Partially refunded",
    recorded: "Recorded",
    reversed: "Reversed",
  }[status]
}

function createDocument(
  subject: string,
  generatedAt: string,
  draw: (flow: FinancePdfFlow) => void,
) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const document = new PDFDocument({
      autoFirstPage: true,
      bufferPages: true,
      compress: true,
      info: {
        Author: "Sathiya Moorthy Badminton Academy",
        CreationDate: new Date(generatedAt),
        Creator: "SMBA Portal",
        Subject: subject,
        Title: subject,
      },
      margin: PAGE_MARGIN,
      size: "A4",
    })
    document.on("data", (chunk: Buffer) => chunks.push(chunk))
    document.on("end", () => resolve(Buffer.concat(chunks)))
    document.on("error", reject)

    try {
      const flow = new FinancePdfFlow(document, subject)
      draw(flow)
      flow.finish(generatedAt)
      document.end()
    } catch (error) {
      document.end()
      reject(error)
    }
  })
}

class FinancePdfFlow {
  private readonly document: PDFKit.PDFDocument
  private readonly documentLabel: string
  private cursorY = 148

  constructor(document: PDFKit.PDFDocument, documentLabel: string) {
    this.document = document
    this.documentLabel = documentLabel
    this.drawPageHeader()
  }

  private drawPageHeader() {
    const logoPath = path.join(process.cwd(), "public", "images", "smba-logo.jpeg")
    this.document.rect(0, 0, this.document.page.width, this.document.page.height).fill(IVORY)
    this.document.image(logoPath, PAGE_MARGIN, 35, { fit: [112, 76] })
    this.document
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(RED)
      .text("ACADEMY FEE RECORD", 284, 48, {
        align: "right",
        characterSpacing: 1.15,
        width: this.document.page.width - 334,
      })
      .font("Helvetica")
      .fontSize(8)
      .fillColor(STEEL)
      .text(this.documentLabel, 284, 68, {
        align: "right",
        width: this.document.page.width - 334,
      })
      .moveTo(PAGE_MARGIN, 120)
      .lineTo(this.document.page.width - PAGE_MARGIN, 120)
      .lineWidth(1.2)
      .strokeColor(NAVY)
      .stroke()
      .moveTo(PAGE_MARGIN, 124)
      .lineTo(170, 124)
      .lineWidth(2.4)
      .strokeColor(RED)
      .stroke()
    this.cursorY = 148
  }

  private newPage() {
    this.document.addPage()
    this.drawPageHeader()
  }

  ensure(height: number) {
    if (this.cursorY + height > CONTENT_BOTTOM) this.newPage()
  }

  gap(height: number) {
    this.cursorY += height
  }

  title(title: string, subtitle: string, status?: { label: string; tone: string }) {
    const titleWidth = status ? 350 : this.document.page.width - PAGE_MARGIN * 2
    const titleHeight = this.document
      .font("Helvetica-Bold")
      .fontSize(25)
      .heightOfString(title, { width: titleWidth })
    const subtitleHeight = this.document
      .font("Helvetica")
      .fontSize(9.5)
      .heightOfString(subtitle, { lineGap: 2, width: titleWidth })
    const height = titleHeight + subtitleHeight + 17
    this.ensure(height)
    const y = this.cursorY
    this.document
      .font("Helvetica-Bold")
      .fontSize(25)
      .fillColor(NAVY)
      .text(title, PAGE_MARGIN, y, { width: titleWidth })
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(STEEL)
      .text(subtitle, PAGE_MARGIN, y + titleHeight + 6, {
        lineGap: 2,
        width: titleWidth,
      })
    if (status) {
      const badgeWidth = 118
      const badgeX = this.document.page.width - PAGE_MARGIN - badgeWidth
      this.document
        .roundedRect(badgeX, y + 2, badgeWidth, 25, 12.5)
        .fill(status.tone)
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .fillColor(WHITE)
        .text(status.label.toLocaleUpperCase("en-IN"), badgeX + 9, y + 10, {
          align: "center",
          characterSpacing: 0.65,
          width: badgeWidth - 18,
        })
    }
    this.cursorY += height
  }

  metadata(items: Array<[string, string]>) {
    const width = (this.document.page.width - PAGE_MARGIN * 2 - 12) / 2
    const rows = Math.ceil(items.length / 2)
    const height = rows * 51 + 9
    this.ensure(height)
    const startY = this.cursorY
    items.forEach(([label, value], index) => {
      const column = index % 2
      const row = Math.floor(index / 2)
      const x = PAGE_MARGIN + column * (width + 12)
      const y = startY + row * 51
      this.document
        .font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(RED)
        .text(label, x, y, { characterSpacing: 0.75, width })
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor(NAVY)
        .text(value, x, y + 14, {
          ellipsis: true,
          height: 26,
          lineGap: 1,
          width,
        })
    })
    this.cursorY += height
  }

  section(label: string) {
    this.ensure(39)
    this.document
      .moveTo(PAGE_MARGIN, this.cursorY)
      .lineTo(this.document.page.width - PAGE_MARGIN, this.cursorY)
      .lineWidth(0.6)
      .strokeColor("#d2d0c9")
      .stroke()
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(RED)
      .text(label.toLocaleUpperCase("en-IN"), PAGE_MARGIN, this.cursorY + 14, {
        characterSpacing: 1,
      })
    this.cursorY += 39
  }

  record({
    title,
    subtitle,
    amount,
    status,
    detailLines = [],
  }: {
    title: string
    subtitle: string
    amount: string
    status?: { label: string; tone: string }
    detailLines?: string[]
  }) {
    const width = this.document.page.width - PAGE_MARGIN * 2
    const copyWidth = width - 158
    const titleHeight = this.document
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .heightOfString(title, { width: copyWidth })
    const subtitleHeight = this.document
      .font("Helvetica")
      .fontSize(8.5)
      .heightOfString(subtitle, { lineGap: 1.5, width: copyWidth })
    const detailHeight = detailLines.reduce((total, line) => total + this.document
      .font("Helvetica")
      .fontSize(8)
      .heightOfString(line, { lineGap: 1, width: width - 30 }) + 4, 0)
    const height = Math.max(58, titleHeight + subtitleHeight + detailHeight + 29)
    this.ensure(height + 8)
    const y = this.cursorY
    this.document
      .roundedRect(PAGE_MARGIN, y, width, height, 3)
      .fill(PALE)
      .rect(PAGE_MARGIN, y, 3, height)
      .fill(RED)
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .fillColor(NAVY)
      .text(title, PAGE_MARGIN + 15, y + 13, { width: copyWidth })
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(STEEL)
      .text(subtitle, PAGE_MARGIN + 15, y + 17 + titleHeight, {
        lineGap: 1.5,
        width: copyWidth,
      })
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(NAVY)
      .text(amount, this.document.page.width - PAGE_MARGIN - 130, y + 13, {
        align: "right",
        width: 115,
      })
    if (status) {
      this.document
        .font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(status.tone)
        .text(status.label.toLocaleUpperCase("en-IN"), this.document.page.width - PAGE_MARGIN - 130, y + 31, {
          align: "right",
          characterSpacing: 0.55,
          width: 115,
        })
    }
    let detailY = y + 23 + titleHeight + subtitleHeight
    detailLines.forEach((line) => {
      const lineHeight = this.document
        .font("Helvetica")
        .fontSize(8)
        .heightOfString(line, { lineGap: 1, width: width - 30 })
      this.document.fillColor(STEEL).text(line, PAGE_MARGIN + 15, detailY, {
        lineGap: 1,
        width: width - 30,
      })
      detailY += lineHeight + 4
    })
    this.cursorY += height + 8
  }

  total(items: Array<[string, string]>, emphasisIndex = items.length - 1) {
    const height = items.length * 26 + 22
    this.ensure(height)
    const width = this.document.page.width - PAGE_MARGIN * 2
    const y = this.cursorY
    this.document.roundedRect(PAGE_MARGIN, y, width, height, 3).fill(NAVY)
    items.forEach(([label, value], index) => {
      const rowY = y + 13 + index * 26
      this.document
        .font(index === emphasisIndex ? "Helvetica-Bold" : "Helvetica")
        .fontSize(index === emphasisIndex ? 10 : 8.5)
        .fillColor(index === emphasisIndex ? WHITE : "#b9c9e5")
        .text(label, PAGE_MARGIN + 18, rowY, { width: width / 2 })
        .text(value, PAGE_MARGIN + width / 2, rowY, {
          align: "right",
          width: width / 2 - 18,
        })
    })
    this.cursorY += height + 9
  }

  note(text: string) {
    const width = this.document.page.width - PAGE_MARGIN * 2
    const textHeight = this.document
      .font("Helvetica")
      .fontSize(8)
      .heightOfString(text, { lineGap: 2, width })
    this.ensure(textHeight + 18)
    this.document
      .font("Helvetica")
      .fontSize(8)
      .fillColor(STEEL)
      .text(text, PAGE_MARGIN, this.cursorY + 6, {
        align: "center",
        lineGap: 2,
        width,
      })
    this.cursorY += textHeight + 18
  }

  finish(generatedAt: string) {
    const range = this.document.bufferedPageRange()
    for (let page = range.start; page < range.start + range.count; page += 1) {
      this.document.switchToPage(page)
      const footerY = this.document.page.height - 61
      this.document
        .moveTo(PAGE_MARGIN, footerY - 10)
        .lineTo(this.document.page.width - PAGE_MARGIN, footerY - 10)
        .lineWidth(0.5)
        .strokeColor("#d2d0c9")
        .stroke()
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(STEEL)
        .text(`Generated ${generatedLabel(generatedAt)}`, PAGE_MARGIN, footerY, {
          width: 260,
        })
        .text(`Page ${page - range.start + 1} of ${range.count}`, 310, footerY, {
          align: "right",
          width: this.document.page.width - PAGE_MARGIN - 310,
        })
    }
  }
}

function receiptLines(receipt: FinanceStatementReceipt | FinanceReceiptDocument) {
  const refundLines = receipt.refunds.map((refund) => (
    `Refund ${refund.refundReference} - ${money(refund.amountPaise)} - ${dateKey(refund.refundedOn)}${refund.lifecycle === "reversed" ? " - reversed" : ""}`
  ))
  return [
    ...receipt.allocations.map((allocation) => (
      `${allocation.description} - ${allocation.feeReference} - ${money(allocation.amountPaise)}`
    )),
    ...refundLines,
  ]
}

function drawReceipt(flow: FinancePdfFlow, receipt: FinanceReceiptDocument) {
  const status = receiptStatusLabel(receipt.status)
  flow.title(
    "Payment receipt",
    `${receipt.playerName} - ${receipt.academyId}`,
    { label: status, tone: statusTone(receipt.status) },
  )
  flow.metadata([
    ["RECEIPT REFERENCE", receipt.receiptReference],
    ["RECEIVED ON", dateKey(receipt.receivedOn)],
    ["PAYMENT METHOD", METHOD_LABELS[receipt.method]],
    ["PAYMENT REFERENCE", receipt.externalReference ?? "Not recorded"],
  ])
  flow.section("Applied fees")
  receipt.allocations.forEach((allocation) => flow.record({
    title: allocation.description,
    subtitle: `Fee reference ${allocation.feeReference}`,
    amount: money(allocation.amountPaise),
  }))
  if (receipt.refunds.length) {
    flow.section("Refund history")
    receipt.refunds.forEach((refund) => flow.record({
      title: `Refund ${refund.refundReference}`,
      subtitle: dateKey(refund.refundedOn),
      amount: money(refund.amountPaise),
      status: {
        label: refund.lifecycle === "reversed" ? "Reversed" : "Recorded",
        tone: statusTone(refund.lifecycle),
      },
    }))
  }
  flow.section("Receipt total")
  flow.total([
    ["Amount received", money(receipt.amountPaise)],
    ["Active refunds", money(receipt.refundedPaise)],
    ["Net recorded", money(receipt.netReceivedPaise)],
  ])
  flow.note("Academy fee record only. This document is not a GST or tax invoice.")
}

function adjustmentLines(charge: FinanceStatementCharge) {
  return charge.adjustments.map((adjustment) => (
    `${ADJUSTMENT_LABELS[adjustment.kind]} - ${money(adjustment.amountPaise)} - ${formatAcademyDate(adjustment.createdAt)}${adjustment.lifecycle === "reversed" ? " - reversed" : ""}`
  ))
}

function drawCharge(flow: FinancePdfFlow, charge: FinanceStatementCharge) {
  flow.record({
    title: charge.description,
    subtitle: `${charge.feeReference} - Due ${dateKey(charge.dueDate)}`,
    amount: money(charge.effectiveAmountPaise),
    status: {
      label: charge.lifecycle === "void" ? "Void" : STATUS_LABELS[charge.status],
      tone: statusTone(charge.lifecycle === "void" ? "void" : charge.status),
    },
    detailLines: [
      `Original ${money(charge.originalAmountPaise)} - Received ${money(charge.receivedPaise)} - Outstanding ${money(charge.outstandingPaise)}`,
      ...adjustmentLines(charge),
    ],
  })
}

function drawStatement(flow: FinancePdfFlow, statement: FinanceStatementDocument) {
  flow.title(
    "Player fee statement",
    `${statement.playerName} - ${statement.academyId}${statement.archived ? " - Archived player" : ""}`,
    { label: STATUS_LABELS[statement.status], tone: statusTone(statement.status) },
  )
  flow.metadata([
    ["PLAYER", statement.playerName],
    ["ACADEMY ID", statement.academyId],
    ["CURRENT BALANCE", money(statement.currentBalancePaise)],
    ["GENERATED", generatedLabel(statement.generatedAt)],
  ])
  flow.section("Charges and adjustments")
  if (statement.charges.length) {
    statement.charges.forEach((charge) => drawCharge(flow, charge))
  } else {
    flow.note("No fee Charges have been recorded for this player.")
  }
  flow.section("Receipts and refunds")
  if (statement.receipts.length) {
    statement.receipts.forEach((receipt) => flow.record({
      title: `Receipt ${receipt.receiptReference}`,
      subtitle: `${dateKey(receipt.receivedOn)} - ${METHOD_LABELS[receipt.method]}`,
      amount: money(receipt.amountPaise),
      status: {
        label: receiptStatusLabel(receipt.status),
        tone: statusTone(receipt.status),
      },
      detailLines: receiptLines(receipt),
    }))
  } else {
    flow.note("No receipts have been recorded for this player.")
  }
  flow.section("Current balance")
  flow.total([["Outstanding balance", money(statement.currentBalancePaise)]], 0)
  flow.note(
    "This statement reflects the academy ledger at its generation time. It is an academy fee record, not a GST or tax invoice.",
  )
}

export function createFinanceReceiptPdf(receipt: FinanceReceiptDocument) {
  return createDocument(
    `Payment receipt ${receipt.receiptReference}`,
    receipt.generatedAt,
    (flow) => drawReceipt(flow, receipt),
  )
}

export function createPlayerFeeStatementPdf(statement: FinanceStatementDocument) {
  return createDocument(
    `Player fee statement - ${statement.playerName}`,
    statement.generatedAt,
    (flow) => drawStatement(flow, statement),
  )
}

/** Returns the page count without parsing or mutating a generated document. */
export function countPdfPages(buffer: Buffer) {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page\b/gu) ?? []).length
}

export type { FinancePdf }
