import { portalRepository, sessionProvider } from "@/lib/data"
import { createMonthlyReportPdf } from "@/lib/reports/pdf"

export const runtime = "nodejs"

const privateResponseHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "")
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const identity = await sessionProvider.getCurrentIdentity()
  if (!identity || identity.role !== "player") {
    return new Response("Authentication required.", {
      headers: privateResponseHeaders,
      status: 401,
    })
  }

  const { reportId } = await params
  const report = await portalRepository.getReport(identity.subjectId, reportId)
  if (!report) {
    return new Response("Report not found.", {
      headers: privateResponseHeaders,
      status: 404,
    })
  }

  try {
    const pdf = await createMonthlyReportPdf(report, identity.fullName)
    const fileName = safeFileName(`SMBA ${identity.fullName} ${report.monthLabel} Report`)

    return new Response(new Uint8Array(pdf), {
      headers: {
        ...privateResponseHeaders,
        "Content-Disposition": `attachment; filename="${fileName}.pdf"`,
        "Content-Type": "application/pdf",
      },
    })
  } catch {
    console.error("Monthly report PDF generation failed.", { reportId })
    return new Response("Unable to generate report.", {
      headers: privateResponseHeaders,
      status: 500,
    })
  }
}
