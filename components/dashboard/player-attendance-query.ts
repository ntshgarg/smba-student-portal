export type PlayerAttendanceNavigationState = {
  isOpen: boolean
  activeYear: number
  activeMonth: number
}

function fallbackYear(years: number[], currentYear: number) {
  return years.includes(currentYear) ? currentYear : years[0] ?? currentYear
}

function validMonth(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 12
}

export function parsePlayerAttendanceNavigation(
  searchParams: Pick<URLSearchParams, "get">,
  years: number[],
  currentYear: number,
  currentMonth: number,
): PlayerAttendanceNavigationState {
  const requestedYear = Number(searchParams.get("year"))
  const requestedMonth = Number(searchParams.get("month"))

  return {
    isOpen: searchParams.get("attendance") === "register",
    activeYear: years.includes(requestedYear)
      ? requestedYear
      : fallbackYear(years, currentYear),
    activeMonth: validMonth(requestedMonth) ? requestedMonth : currentMonth,
  }
}

export function playerAttendanceSearch(
  currentSearch: string | URLSearchParams,
  state: PlayerAttendanceNavigationState,
  currentYear: number,
  currentMonth: number,
) {
  const parameters = new URLSearchParams(currentSearch)
  parameters.delete("attendance")
  parameters.delete("year")
  parameters.delete("month")

  if (state.isOpen) parameters.set("attendance", "register")
  if (state.activeYear !== currentYear) parameters.set("year", String(state.activeYear))
  if (state.activeMonth !== currentMonth) {
    parameters.set("month", String(state.activeMonth).padStart(2, "0"))
  }

  return parameters.toString()
}

export function shiftPlayerAttendanceMonth(
  state: PlayerAttendanceNavigationState,
  offset: -1 | 1,
  years: number[],
) {
  const monthIndex = state.activeYear * 12 + state.activeMonth - 1 + offset
  const activeYear = Math.floor(monthIndex / 12)
  const activeMonth = monthIndex - activeYear * 12 + 1

  return years.includes(activeYear)
    ? { ...state, activeYear, activeMonth }
    : state
}
