type OccurrenceStart = {
  startsAt: Date | string
}

export type ReferenceInstant = Date | number | string

function instantMilliseconds(value: ReferenceInstant, label: string) {
  const milliseconds = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid ${label}.`)
  return milliseconds
}

export function occurrenceHasStarted(
  occurrence: OccurrenceStart,
  referenceInstant: ReferenceInstant,
) {
  return instantMilliseconds(occurrence.startsAt, "session start time")
    <= instantMilliseconds(referenceInstant, "reference time")
}

export function occurrenceIsUpcoming(
  occurrence: OccurrenceStart,
  referenceInstant: ReferenceInstant,
) {
  return !occurrenceHasStarted(occurrence, referenceInstant)
}
