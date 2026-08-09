type ReportMonth = {
  month: string
}

export function reportYearFromMonth(month: string) {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month)
    ? month.slice(0, 4)
    : "Earlier"
}

export function groupReportsByYear<T extends ReportMonth>(reports: T[]) {
  const groups = new Map<string, T[]>()
  ;[...reports]
    .sort((first, second) => second.month.localeCompare(first.month))
    .forEach((report) => {
      const year = reportYearFromMonth(report.month)
      groups.set(year, [...(groups.get(year) ?? []), report])
    })

  return [...groups.entries()]
    .sort(([first], [second]) => {
      if (first === "Earlier") return 1
      if (second === "Earlier") return -1
      return second.localeCompare(first)
    })
    .map(([year, groupedReports]) => ({ year, reports: groupedReports }))
}
