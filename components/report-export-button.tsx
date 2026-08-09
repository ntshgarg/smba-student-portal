import { FileDown } from "lucide-react"

type ReportExportButtonProps = {
  monthLabel: string
  playerName: string
  reportId: string
}

export function ReportExportButton({
  monthLabel,
  playerName,
  reportId,
}: ReportExportButtonProps) {
  const fileName = `SMBA-${playerName}-${monthLabel}-Report.pdf`.replaceAll(" ", "-")

  return (
    <a
      className="report-export-button"
      download={fileName}
      href={`/player/reports/${reportId}/download`}
    >
      <FileDown aria-hidden="true" />
      <span>Download report</span>
    </a>
  )
}
