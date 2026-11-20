import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/index.ts", "src/node.ts", "src/browser.ts"],
    },
  },
});
