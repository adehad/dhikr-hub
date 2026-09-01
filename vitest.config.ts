import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: { unsafeEphemeralDurableObjects: true },
    }),
  ],
  test: {
    include: ["worker/test/**/*.spec.ts"],
    // Each test drives a real workerd; on a busy machine that outlasts vitest's 5s default.
    testTimeout: 15_000,
  },
});
