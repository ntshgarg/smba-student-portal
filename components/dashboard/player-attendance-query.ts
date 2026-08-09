export type PlayerAttendanceNavigationState = {
  isOpen: boolean
  activeYear: number
}

function fallbackYear(years: number[], currentYear: number) {
  return years.includes(currentYear) ? currentYear : years[0] ?? currentYear
}

export function parsePlayerAttendanceNavigation(
  searchParams: Pick<URLSearchParams, "get">,
  years: number[],
  currentYear: number,
): PlayerAttendanceNavigationState {
  const requestedYear = Number(searchParams.get("year"))

  return {
    isOpen: searchParams.get("attendance") === "register",
    activeYear: years.includes(requestedYear)
      ? requestedYear
      : fallbackYear(years, currentYear),
  }
}

export function playerAttendanceSearch(
  currentSearch: string | URLSearchParams,
  state: PlayerAttendanceNavigationState,
  currentYear: number,
) {
  const parameters = new URLSearchParams(currentSearch)
  parameters.delete("attendance")
  parameters.delete("year")

  if (state.isOpen) parameters.set("attendance", "register")
  if (state.activeYear !== currentYear) parameters.set("year", String(state.activeYear))

  return parameters.toString()
}
