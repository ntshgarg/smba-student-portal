import { getAcademyDateKey } from "@/lib/format"

export function getIndiaDateKey(value = new Date()) {
  return getAcademyDateKey(value)
}
