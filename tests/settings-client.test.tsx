// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsClient } from "@/components/settings-client";

const integrationStatus = {
  provider: "xunji",
  configured: false,
  maskedKey: null,
  verifiedAt: null,
  updatedAt: null,
  sync: {
    status: "idle",
    lastAttemptAt: null,
    lastSucceededAt: null,
    lastSucceededDate: null,
    lastErrorCode: null,
  },
};

const garminStatus = {
  provider: "garmin",
  state: "not_connected",
  verifiedAt: null,
  updatedAt: null,
  lastErrorCode: null,
};

const garminWellnessProgress = {
  provider: "garmin",
  kind: "daily_wellness",
  sync: {
    status: "idle",
    lastAttemptAt: null,
    lastSucceededDate: null,
    nextCursor: null,
    lastErrorCode: null,
  },
};

const deepSeekStatus = {
  schemaVersion: "1.0.0",
  provider: "deepseek",
  model: "deepseek-v4-flash",
  hasCredential: false,
  state: "not_connected",
  verifiedAt: null,
  updatedAt: null,
  lastErrorCode: null,
};

const mirrorStatus = {
  configuration: "configured",
  pendingCount: 0,
  processingCount: 0,
  failedCount: 0,
  oldestPendingAt: null,
  lastSucceededAt: null,
  permissionError: false,
  delayed: false,
};

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function renderSettings() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
        })
      }
    >
      <SettingsClient />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("settings client data boundary", () => {
  it("shows the stable settings shell before status requests finish", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    renderSettings();

    expect(screen.getByRole("main", { name: "设置页面" })).toBeTruthy();
    expect(screen.getByText("正在加载设置…")).toBeTruthy();
    expect(screen.getAllByTestId("settings-row-skeleton")).toHaveLength(5);
    expect(screen.queryByText(/正在切换/)).toBeNull();
  });

  it("loads status summaries in parallel without exposing detail inputs on the first level", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve(
        jsonResponse(
          url === "/api/mirror/status"
            ? mirrorStatus
            : url.includes("/deepseek/")
              ? deepSeekStatus
              : url.endsWith("/garmin/wellness")
                ? garminWellnessProgress
                : url.includes("/garmin/")
                  ? garminStatus
                  : integrationStatus,
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();

    expect(await screen.findByRole("link", { name: /Garmin/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /训记/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /DeepSeek/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /GitHub 数据备份/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /本机数据/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /账号/ })).toBeTruthy();
    expect(screen.queryByLabelText("API Key")).toBeNull();
    expect(screen.queryByLabelText("DeepSeek API Key")).toBeNull();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
      expect.arrayContaining([
        "/api/trackers/knee-rehab/integrations/xunji/credential",
        "/api/trackers/knee-rehab/integrations/garmin/credential",
        "/api/trackers/knee-rehab/integrations/deepseek/credential",
        "/api/mirror/status",
      ]),
    );
  });

  it("surfaces a failed integration as an actionable first-level exception", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve(
        jsonResponse(
          url.includes("/garmin/")
            ? { ...garminStatus, state: "needs_refresh" }
            : url === "/api/mirror/status"
              ? mirrorStatus
              : url.includes("/deepseek/")
                ? deepSeekStatus
                : integrationStatus,
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();

    expect(await screen.findByText("1 项需要处理")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Garmin需要处理/ })).toBeTruthy();
    expect(screen.queryByText("全部正常")).toBeNull();
  });

  it("shows the persisted Xunji reason on the first-level row", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve(
        jsonResponse(
          url.includes("/xunji/")
            ? {
                ...integrationStatus,
                configured: true,
                maskedKey: "••••••••",
                sync: {
                  ...integrationStatus.sync,
                  status: "failed",
                  lastErrorCode: "membership_required",
                },
              }
            : url.includes("/garmin/")
              ? garminStatus
              : url === "/api/mirror/status"
                ? mirrorStatus
                : url.includes("/deepseek/")
                  ? deepSeekStatus
                  : integrationStatus,
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();

    expect(
      await screen.findByRole("link", { name: /训记仅限 VIP 会员/ }),
    ).toBeTruthy();
    expect(screen.getByText("1 项需要处理")).toBeTruthy();
  });
});
