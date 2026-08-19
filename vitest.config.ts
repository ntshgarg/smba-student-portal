import { fileURLToPath } from "node:url"
import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    // The regression-fixture suite launches database build subprocesses. A
    // small worker cap keeps that file below Vitest 3's fixed 60-second RPC
    // timeout instead of letting unrelated test workers compete for CPU.
    maxWorkers: 2,
    minWorkers: 1,
  },
})
