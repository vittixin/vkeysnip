import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vitest/config";
import manifest from "./src/manifest.config";

export default defineConfig({
  plugins: [crx({ manifest })],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
