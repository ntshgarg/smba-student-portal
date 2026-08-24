import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import { getPlayerFeeStatement } from "@/lib/finance/documents"
import { createPlayerFeeStatementPdf } from "@/lib/finance/pdf"
import {
  authorizeDownload,
  downloadFailureResponse,
  privateAttachmentResponse,
  privateDownloadResponse,
  safeFileName,
} from "@/lib/http/download-route"
import { financeDownloadRejection } from "@/lib/http/finance-download-route"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ playerId: string }> },
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

  const { playerId } = await params
  try {
    const statement = getPlayerFeeStatement(playerId, { coachId: identity.subjectId })
    if (!statement) return privateDownloadResponse("Financial record not found.", 404)

    const pdf = await createPlayerFeeStatementPdf(statement)
    const fileName = safeFileName(
      `SMBA ${statement.playerName} ${statement.academyId} Fee Statement`,
      "SMBA-Player-Fee-Statement",
    )

    return privateAttachmentResponse(new Uint8Array(pdf), {
      contentType: "application/pdf",
      fileName: `${fileName}.pdf`,
    })
  } catch (error) {
    return financeDownloadRejection(error) ?? downloadFailureResponse(error, {
      context: { playerId },
      label: "Player fee statement PDF generation failed.",
      message: "Unable to generate the financial record.",
    })
  }
}
