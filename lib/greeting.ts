import { ACADEMY_TIME_ZONE } from "@/lib/format"

export function currentGreeting(timeZone = ACADEMY_TIME_ZONE) {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(new Date()),
  )

  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}
