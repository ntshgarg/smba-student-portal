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
    // Anchored at the real suite root. A deny-list alone cannot cover an
    // extracted worktree under a name nobody has thought of yet, and those
    // copies collect as duplicates of tests that already pass here.
    include: ["tests/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    // Verified against Vitest 3.2.4: a CLI --exclude, as test:ci passes for
    // tests/regression-fixture.test.ts, adds to this list rather than
    // replacing it.
    exclude: [
      ...configDefaults.exclude,
      "tests/e2e/**",
      "**/output/**",
      "**/.next/**",
      "**/coverage/**",
    ],
  },
})
