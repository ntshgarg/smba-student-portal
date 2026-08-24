import { ACADEMY_TIME_ZONE, dateTimeFormatter } from "@/lib/format"

export function currentGreeting(timeZone = ACADEMY_TIME_ZONE) {
  /* The zone is a parameter, so this cannot be hoisted; the shared cache keys on it. */
  const hour = Number(
    dateTimeFormatter("en-IN", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(new Date()),
  )

  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}
