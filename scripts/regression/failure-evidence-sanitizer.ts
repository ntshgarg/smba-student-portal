// The rules moved to lib/telemetry/redaction.ts once the client error reporter
// needed the same guarantees. This module keeps its original import path so the
// Playwright evidence fixtures continue to resolve it.
export {
  sanitizeFailureText,
  sanitizeFailureUrl,
} from "../../lib/telemetry/redaction"
