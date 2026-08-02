import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "startup-performance.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    channel: "chrome",
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "PLAYWRIGHT_TEST=1 AK_TEST_AUTH_DELAY_MS=1600 AUTH_SECRET=anonymous-startup-browser-test-secret ALLOWED_GITHUB_ID=10001 NEXTAUTH_URL=http://127.0.0.1:4175 pnpm start --hostname 127.0.0.1 --port 4175",
    url: "http://127.0.0.1:4175/login",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
