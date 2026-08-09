import { type NextRequest, NextResponse } from "next/server"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await params
  return NextResponse.redirect(
    new URL(`/player/reports/${reportId}/download`, request.url),
    308,
  )
}
