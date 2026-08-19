import type { Instrumentation } from "next"

export function register() {}

export const onRequestError: Instrumentation.onRequestError = (...input) => {
  if (process.env.NEXT_RUNTIME === "edge") return
  // Next.js requires a conditional CommonJS boundary to keep Node-only telemetry out of its Edge bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { recordRequestError } = require("./lib/operations/record-request-error.node") as {
    recordRequestError: Instrumentation.onRequestError
  }
  return recordRequestError(...input)
}
