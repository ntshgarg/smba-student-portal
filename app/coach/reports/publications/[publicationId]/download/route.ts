import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import {
  coachPublishedReportAsMonthlyReport,
  getCoachPublishedReportDetail,
} from "@/lib/reports/coach-archive"
import { createMonthlyReportPdf } from "@/lib/reports/pdf"

export const runtime = "nodejs"

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const

function safeFileName(value: string) {
  const normalized = value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120)
  return normalized || "SMBA-Monthly-Report"
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicationId: string }> },
) {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity || identity.role !== "coach") {
    return new Response("Authentication required.", {
      headers: privateHeaders,
      status: 401,
    })
  }
  try {
    requireHeadAdminAccess(identity.subjectId)
  } catch {
    return new Response("Head coach access is required.", {
      headers: privateHeaders,
      status: 403,
    })
  }

  const { publicationId } = await params
  try {
    const publication = getCoachPublishedReportDetail(identity.subjectId, publicationId)
    if (!publication) {
      return new Response("Report not found.", {
        headers: privateHeaders,
        status: 404,
      })
    }

    const pdfReport = coachPublishedReportAsMonthlyReport(publication)
    const pdf = await createMonthlyReportPdf(pdfReport, publication.playerName)
    const fileName = safeFileName(
      `SMBA ${publication.playerName} ${publication.month} Report R${publication.revision}`,
    )

    return new Response(new Uint8Array(pdf), {
      headers: {
        ...privateHeaders,
        "Content-Disposition": `attachment; filename="${fileName}.pdf"`,
        "Content-Type": "application/pdf",
      },
    })
  } catch {
    console.error("Coach report PDF generation failed.", { publicationId })
    return new Response("Unable to generate report.", {
      headers: privateHeaders,
      status: 500,
    })
  }
}
