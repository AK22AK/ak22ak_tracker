import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "navigation-performance.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    channel: "chrome",
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "AUTH_SECRET=anonymous-navigation-browser-test-secret ALLOWED_GITHUB_ID=10001 NEXTAUTH_URL=http://127.0.0.1:4174 pnpm start --hostname 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174/login",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
