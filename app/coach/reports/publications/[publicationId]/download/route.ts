import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import {
  authorizeDownload,
  downloadFailureResponse,
  privateAttachmentResponse,
  privateDownloadResponse,
  safeFileName,
} from "@/lib/http/download-route"
import {
  coachPublishedReportAsMonthlyReport,
  getCoachPublishedReportDetail,
} from "@/lib/reports/coach-archive"
import { createMonthlyReportPdf } from "@/lib/reports/pdf"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicationId: string }> },
) {
  const access = authorizeDownload(
    await sessionProvider.getCurrentIdentity(),
    "coach",
    {
      check: (coach) => requireHeadAdminAccess(coach.subjectId),
      deniedMessage: "Head coach access is required.",
    },
  )
  if (!access.allowed) return access.rejection
  const { identity } = access

  const { publicationId } = await params
  try {
    const publication = getCoachPublishedReportDetail(identity.subjectId, publicationId)
    if (!publication) return privateDownloadResponse("Report not found.", 404)

    const pdfReport = coachPublishedReportAsMonthlyReport(publication)
    const pdf = await createMonthlyReportPdf(pdfReport, publication.playerName)
    const fileName = safeFileName(
      `SMBA ${publication.playerName} ${publication.month} Report R${publication.revision}`,
      "SMBA-Monthly-Report",
    )

    return privateAttachmentResponse(new Uint8Array(pdf), {
      contentType: "application/pdf",
      fileName: `${fileName}.pdf`,
    })
  } catch (error) {
    return downloadFailureResponse(error, {
      context: { publicationId },
      label: "Coach report PDF generation failed.",
      message: "Unable to generate report.",
    })
  }
}
