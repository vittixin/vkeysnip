import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30_000,
  webServer: {
    command: "npm run test:e2e:serve",
    url: "http://127.0.0.1:4173/plain-input.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    browserName: "chromium",
    headless: true,
  },
});
