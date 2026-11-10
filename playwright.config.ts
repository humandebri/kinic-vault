import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 90000,
  use: {
    actionTimeout: 15000,
    baseURL: "http://localhost:5173",
    browserName: "chromium",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "node tools/local.mjs",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
