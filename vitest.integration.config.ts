import { defineConfig } from "vitest/config";
import path from "node:path";

/** DB-backed service tests against the local Postgres (docker). Run: npm run test:integration */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/support/load-env.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
