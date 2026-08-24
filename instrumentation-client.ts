import { installRejectionReporter } from "@/lib/telemetry/install-rejection-reporter"

// Next.js evaluates this file on the client before the application's own code,
// once per page load. It is the only place a global listener can be installed
// for every route without a layout change.
installRejectionReporter()
