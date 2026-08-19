import { createHash, randomUUID } from "node:crypto"

import type { Instrumentation } from "next"

import { initializeDatabase } from "@/lib/db/client"
import { operationalEvents } from "@/lib/db/schema"

export const recordRequestError: Instrumentation.onRequestError = async (
  error,
  _request,
  context,
) => {
  try {
    const digest = typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : error instanceof Error
        ? `${error.name}:${error.message}`
        : String(error)
    const fingerprint = createHash("sha256").update(digest).digest("hex")

    initializeDatabase().insert(operationalEvents).values({
      id: randomUUID(),
      eventType: "application_error",
      fingerprint,
      routePath: context.routePath.slice(0, 240),
      occurredAt: new Date(),
    }).run()
  } catch {
    // The original request error remains Next.js's responsibility. Avoid
    // leaking its content or creating a recursive database failure here.
    console.error("SMBA could not persist a sanitized operational error event.")
  }
}
