import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import { getReceiptDocument } from "@/lib/finance/documents"
import { createFinanceReceiptPdf } from "@/lib/finance/pdf"
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
  { params }: { params: Promise<{ paymentId: string }> },
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

  const { paymentId } = await params
  try {
    const receipt = getReceiptDocument(paymentId, { coachId: identity.subjectId })
    if (!receipt) return privateDownloadResponse("Financial record not found.", 404)

    const pdf = await createFinanceReceiptPdf(receipt)
    const fileName = safeFileName(
      `SMBA ${receipt.playerName} ${receipt.receiptReference} Receipt`,
      "SMBA-Payment-Receipt",
    )

    return privateAttachmentResponse(new Uint8Array(pdf), {
      contentType: "application/pdf",
      fileName: `${fileName}.pdf`,
    })
  } catch (error) {
    return financeDownloadRejection(error) ?? downloadFailureResponse(error, {
      context: { paymentId },
      label: "Financial receipt PDF generation failed.",
      message: "Unable to generate the financial record.",
    })
  }
}
