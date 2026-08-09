import { requireHeadAdminAccess } from "@/lib/auth/coach-access"
import { sessionProvider } from "@/lib/data"
import { getPlayerFeeStatement } from "@/lib/finance/documents"
import { createPlayerFeeStatementPdf } from "@/lib/finance/pdf"
import { FinanceServiceError } from "@/lib/finance/service"

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
  return normalized || "SMBA-Player-Fee-Statement"
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ playerId: string }> },
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

  const { playerId } = await params
  try {
    const statement = getPlayerFeeStatement(playerId, { coachId: identity.subjectId })
    if (!statement) {
      return new Response("Financial record not found.", {
        headers: privateHeaders,
        status: 404,
      })
    }

    const pdf = await createPlayerFeeStatementPdf(statement)
    const fileName = safeFileName(
      `SMBA ${statement.playerName} ${statement.academyId} Fee Statement`,
    )
    return new Response(new Uint8Array(pdf), {
      headers: {
        ...privateHeaders,
        "Content-Disposition": `attachment; filename="${fileName}.pdf"`,
        "Content-Type": "application/pdf",
      },
    })
  } catch (error) {
    if (error instanceof FinanceServiceError && error.code === "AUTHORIZATION") {
      return new Response("Coach access is required.", {
        headers: privateHeaders,
        status: 403,
      })
    }
    console.error("Player fee statement PDF generation failed.", { playerId })
    return new Response("Unable to generate the financial record.", {
      headers: privateHeaders,
      status: 500,
    })
  }
}
