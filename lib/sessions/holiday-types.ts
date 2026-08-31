/**
 * The shape a closure takes once it reaches a client component.
 *
 * Separate from `lib/sessions/holidays.ts` because that module is a service and
 * imports the database; a client component that only needs to know a date is
 * closed should not pull that in.
 */
export type AcademyHolidayRecord = {
  id: string
  dateKey: string
  label: string
}
