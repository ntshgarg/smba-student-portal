import path from "node:path"

import PDFDocument from "pdfkit"

import { formatAcademyDate } from "@/lib/format"
import type { MonthlyReport } from "@/lib/types"

const NAVY = "#081c42"
const RED = "#c91f2b"
const IVORY = "#f6f3ec"
const STEEL = "#617083"
const WHITE = "#ffffff"

const PAGE_MARGIN = 54
const REPORT_COPY_FONT_SIZE = 11.5
const REPORT_COPY_LINE_GAP = 5
const REPORT_COPY_TOP = 57
const REPORT_COPY_BOTTOM = 22
const REPORT_COPY_HORIZONTAL_PADDING = 28
const REPORT_MIN_BOX_HEIGHT = 238

const FIRST_REPORT_Y = 418
const FIRST_REPORT_MAX_BOX_HEIGHT = 306
const CONTINUATION_REPORT_Y = 136
const CONTINUATION_REPORT_MAX_BOX_HEIGHT = 604

type ReportPage = {
  text: string
  type: "first" | "continuation"
}

function formatPublishedDate(value: string) {
  return formatAcademyDate(value, {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function normalizeReportText(reportText: string) {
  return reportText.trim().replace(/\r\n?/gu, "\n") || "No coach feedback was provided."
}

function reportCopyWidth(document: PDFKit.PDFDocument) {
  return document.page.width
    - PAGE_MARGIN * 2
    - REPORT_COPY_HORIZONTAL_PADDING * 2
}

function reportTextHeight(
  document: PDFKit.PDFDocument,
  text: string,
  width: number,
) {
  return document
    .font("Helvetica")
    .fontSize(REPORT_COPY_FONT_SIZE)
    .heightOfString(text, {
      align: "left",
      lineGap: REPORT_COPY_LINE_GAP,
      width,
    })
}

function splitTextForHeight(
  document: PDFKit.PDFDocument,
  text: string,
  width: number,
  maxHeight: number,
) {
  if (reportTextHeight(document, text, width) <= maxHeight) {
    return [text, ""] as const
  }

  let low = 1
  let high = text.length
  let maximumFittingIndex = 0

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = text.slice(0, middle)

    if (reportTextHeight(document, candidate, width) <= maxHeight) {
      maximumFittingIndex = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  if (maximumFittingIndex === 0) {
    throw new Error("The report page does not have enough room for readable text.")
  }

  let splitIndex = maximumFittingIndex
  while (splitIndex > 0 && !/\s/u.test(text[splitIndex - 1] ?? "")) {
    splitIndex -= 1
  }

  // An unusually long uninterrupted token still needs deterministic progress.
  if (splitIndex === 0) splitIndex = maximumFittingIndex

  return [text.slice(0, splitIndex), text.slice(splitIndex)] as const
}

function paginateReportText(
  document: PDFKit.PDFDocument,
  normalizedText: string,
): ReportPage[] {
  const width = reportCopyWidth(document)
  const firstCopyHeight = FIRST_REPORT_MAX_BOX_HEIGHT - REPORT_COPY_TOP - REPORT_COPY_BOTTOM
  const continuationCopyHeight = CONTINUATION_REPORT_MAX_BOX_HEIGHT
    - REPORT_COPY_TOP
    - REPORT_COPY_BOTTOM
  const pages: ReportPage[] = []
  let remaining = normalizedText

  while (remaining.length > 0) {
    const type = pages.length === 0 ? "first" : "continuation"
    const availableHeight = type === "first" ? firstCopyHeight : continuationCopyHeight
    const [pageText, rest] = splitTextForHeight(
      document,
      remaining,
      width,
      availableHeight,
    )

    pages.push({ text: pageText, type })
    remaining = rest
  }

  return pages
}

/**
 * Exposes the deterministic pagination contract for regression tests.
 * Concatenating the returned strings always recreates the normalized source.
 */
export function paginateMonthlyReportText(reportText: string) {
  const document = new PDFDocument({ margin: PAGE_MARGIN, size: "A4" })
  document.on("data", () => undefined)
  const pages = paginateReportText(document, normalizeReportText(reportText))
  document.end()
  return pages.map((page) => page.text)
}

function drawPageBackground(document: PDFKit.PDFDocument) {
  document.rect(0, 0, document.page.width, document.page.height).fill(IVORY)
}

function drawFooter(
  document: PDFKit.PDFDocument,
  pageNumber: number,
  pageCount: number,
) {
  const footerY = document.page.height - 72
  document
    .moveTo(PAGE_MARGIN, footerY - 12)
    .lineTo(document.page.width - PAGE_MARGIN, footerY - 12)
    .lineWidth(0.5)
    .strokeColor("#d9d8d3")
    .stroke()
    .font("Helvetica")
    .fontSize(8)
    .fillColor(STEEL)
    .text("Sathiya Moorthy Badminton Academy", PAGE_MARGIN, footerY, {
      continued: true,
    })
    .text(`Player development record  ·  Page ${pageNumber} of ${pageCount}`, {
      align: "right",
    })
}

function drawLetterhead(document: PDFKit.PDFDocument) {
  const logoPath = path.join(process.cwd(), "public", "images", "smba-logo.jpeg")
  document.image(logoPath, PAGE_MARGIN, 42, { fit: [132, 90] })
  document
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(RED)
    .text("MONTHLY DEVELOPMENT REPORT", 310, 54, {
      align: "right",
      characterSpacing: 1.15,
      width: document.page.width - 364,
    })
    .font("Helvetica")
    .fontSize(8)
    .fillColor(STEEL)
    .text("Private player record", 310, 73, {
      align: "right",
      width: document.page.width - 364,
    })
    .moveTo(PAGE_MARGIN, 142)
    .lineTo(document.page.width - PAGE_MARGIN, 142)
    .lineWidth(1.2)
    .strokeColor(NAVY)
    .stroke()
    .moveTo(PAGE_MARGIN, 146)
    .lineTo(176, 146)
    .lineWidth(2.4)
    .strokeColor(RED)
    .stroke()
}

function drawContinuationHeader(
  document: PDFKit.PDFDocument,
  report: MonthlyReport,
  playerName: string,
) {
  const logoPath = path.join(process.cwd(), "public", "images", "smba-logo.jpeg")
  const copyX = 272
  const copyWidth = document.page.width - 326
  const playerNameY = 57
  document.image(logoPath, PAGE_MARGIN, 32, { fit: [82, 56] })
  document
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(RED)
    .text("MONTHLY DEVELOPMENT REPORT", copyX, 39, {
      align: "right",
      characterSpacing: 0.95,
      width: copyWidth,
    })
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .fillColor(NAVY)
  const playerNameHeight = Math.min(document.heightOfString(playerName, {
    lineGap: 1,
    width: copyWidth,
  }), 25)
  const continuationDetailY = playerNameY + playerNameHeight + 4

  document
    .text(playerName, copyX, playerNameY, {
      align: "right",
      ellipsis: true,
      height: 25,
      lineGap: 1,
      width: copyWidth,
    })
    .font("Helvetica")
    .fontSize(8)
    .fillColor(STEEL)
    .text(`${report.monthLabel}  ·  Coach's report  ·  continued`, copyX, continuationDetailY, {
      align: "right",
      width: copyWidth,
    })
    .moveTo(PAGE_MARGIN, 108)
    .lineTo(document.page.width - PAGE_MARGIN, 108)
    .lineWidth(1.2)
    .strokeColor(NAVY)
    .stroke()
    .moveTo(PAGE_MARGIN, 112)
    .lineTo(176, 112)
    .lineWidth(2.4)
    .strokeColor(RED)
    .stroke()
}

function drawMetadata(
  document: PDFKit.PDFDocument,
  report: MonthlyReport,
  playerName: string,
) {
  document
    .font("Helvetica")
    .fontSize(9)
    .fillColor(RED)
    .text(report.monthLabel.toLocaleUpperCase("en-IN"), PAGE_MARGIN, 176, {
      characterSpacing: 1.1,
    })
    .font("Helvetica-Bold")
    .fontSize(27)
    .fillColor(NAVY)
    .text("Monthly report", PAGE_MARGIN, 195)
    .font("Helvetica")
    .fontSize(10)
    .fillColor(STEEL)
    .text(playerName, PAGE_MARGIN, 232)

  const metadata = [
    ["PLAYER", playerName],
    ["COACH", report.coachName],
    [
      "ATTENDANCE",
      report.attendance.recorded
        ? `${report.attendance.attended} of ${report.attendance.recorded} recorded sessions${report.attendance.pending ? ` · ${report.attendance.pending} pending` : ""}`
        : report.attendance.pending ? "Attendance pending" : "Not recorded",
    ],
    ["PUBLISHED", formatPublishedDate(report.publishedAt)],
  ] as const
  const top = 278
  const width = (document.page.width - PAGE_MARGIN * 2) / 2

  metadata.forEach(([label, value], index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = PAGE_MARGIN + column * width
    const y = top + row * 58
    document
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .fillColor(RED)
      .text(label, x, y, { characterSpacing: 0.9, width: width - 20 })
      .font("Helvetica")
      .fontSize(10)
      .fillColor(NAVY)
      .text(value, x, y + 15, { lineGap: 2, width: width - 20 })
  })
}

function drawCoachReport(
  document: PDFKit.PDFDocument,
  pageText: string,
  y: number,
  maxBoxHeight: number,
  continueOnNextPage: boolean,
) {
  const width = document.page.width - PAGE_MARGIN * 2
  const copyWidth = width - REPORT_COPY_HORIZONTAL_PADDING * 2
  const copyHeight = reportTextHeight(document, pageText, copyWidth)
  const boxHeight = continueOnNextPage
    ? maxBoxHeight
    : Math.min(
      Math.max(copyHeight + REPORT_COPY_TOP + REPORT_COPY_BOTTOM, REPORT_MIN_BOX_HEIGHT),
      maxBoxHeight,
    )

  document
    .save()
    .roundedRect(PAGE_MARGIN, y, width, boxHeight, 3)
    .fill(NAVY)
    .restore()
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor("#b9c9e5")
    .text("COACH'S REPORT", PAGE_MARGIN + REPORT_COPY_HORIZONTAL_PADDING, y + 27, {
      characterSpacing: 1.05,
      width: copyWidth,
    })
    .font("Helvetica")
    .fontSize(REPORT_COPY_FONT_SIZE)
    .fillColor(WHITE)
    .text(pageText, PAGE_MARGIN + REPORT_COPY_HORIZONTAL_PADDING, y + REPORT_COPY_TOP, {
      align: "left",
      height: boxHeight - REPORT_COPY_TOP - REPORT_COPY_BOTTOM,
      lineGap: REPORT_COPY_LINE_GAP,
      width: copyWidth,
    })
}

export function createMonthlyReportPdf(report: MonthlyReport, playerName: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const document = new PDFDocument({
      autoFirstPage: true,
      bufferPages: true,
      info: {
        Author: "Sathiya Moorthy Badminton Academy",
        Subject: `${report.monthLabel} monthly development report`,
        Title: `${report.monthLabel} Monthly Report - ${playerName}`,
      },
      margin: PAGE_MARGIN,
      size: "A4",
    })

    document.on("data", (chunk: Buffer) => chunks.push(chunk))
    document.on("error", reject)
    document.on("end", () => resolve(Buffer.concat(chunks)))

    const normalizedText = normalizeReportText(report.reportText)
    const pages = paginateReportText(document, normalizedText)

    pages.forEach((page, index) => {
      if (index > 0) document.addPage()

      drawPageBackground(document)

      if (page.type === "first") {
        drawLetterhead(document)
        drawMetadata(document, report, playerName)
        drawCoachReport(
          document,
          page.text,
          FIRST_REPORT_Y,
          FIRST_REPORT_MAX_BOX_HEIGHT,
          index < pages.length - 1,
        )
      } else {
        drawContinuationHeader(document, report, playerName)
        drawCoachReport(
          document,
          page.text,
          CONTINUATION_REPORT_Y,
          CONTINUATION_REPORT_MAX_BOX_HEIGHT,
          index < pages.length - 1,
        )
      }

      drawFooter(document, index + 1, pages.length)
    })

    document.end()
  })
}
