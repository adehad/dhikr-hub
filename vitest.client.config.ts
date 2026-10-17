import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["site/assets/live/test/**/*.spec.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
