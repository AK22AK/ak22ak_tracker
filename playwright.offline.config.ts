import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "offline-cold-start.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    channel: "chrome",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  projects: [320, 375, 390, 430].map((width) => ({
    name: `mobile-${width}`,
    use: { viewport: { width, height: 844 } },
  })),
  webServer: {
    command:
      "AUTH_SECRET=anonymous-offline-browser-test-secret NEXTAUTH_URL=http://127.0.0.1:4173 pnpm start --hostname 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/offline.html",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
