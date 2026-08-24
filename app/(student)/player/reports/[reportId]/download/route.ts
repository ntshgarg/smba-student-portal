import { portalRepository, sessionProvider } from "@/lib/data"
import {
  authorizeDownload,
  downloadFailureResponse,
  privateAttachmentResponse,
  privateDownloadResponse,
} from "@/lib/http/download-route"
import { createMonthlyReportPdf } from "@/lib/reports/pdf"

export const runtime = "nodejs"

// Not the shared `safeFileName`: this route has always built its filename
// without NFKD decomposition, so an accented name reduces to "Jos" here and
// would become "Jose" under the shared sanitiser. Unifying the two is a
// user-visible change to the filename of every report a player has already
// downloaded, so it is left as it is.
function safeFileName(value: string) {
  return value.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "")
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const access = authorizeDownload(await sessionProvider.getCurrentIdentity(), "player")
  if (!access.allowed) return access.rejection
  const { identity } = access

  const { reportId } = await params
  const report = await portalRepository.getReport(identity.subjectId, reportId)
  if (!report) return privateDownloadResponse("Report not found.", 404)

  try {
    const pdf = await createMonthlyReportPdf(report, identity.fullName)
    const fileName = safeFileName(`SMBA ${identity.fullName} ${report.monthLabel} Report`)

    return privateAttachmentResponse(new Uint8Array(pdf), {
      contentType: "application/pdf",
      fileName: `${fileName}.pdf`,
    })
  } catch (error) {
    return downloadFailureResponse(error, {
      context: { reportId },
      label: "Monthly report PDF generation failed.",
      message: "Unable to generate report.",
    })
  }
}
