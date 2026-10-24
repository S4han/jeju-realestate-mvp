import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // DB integration tests share one database; run files sequentially.
    fileParallelism: false,
  },
});
