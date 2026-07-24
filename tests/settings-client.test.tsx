// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    expect(screen.getByText("正在加载：Garmin 活动…")).toBeTruthy();
    expect(screen.getByText("正在加载：训练数据源…")).toBeTruthy();
    expect(screen.getByText("正在加载：GitHub 数据备份…")).toBeTruthy();
    expect(screen.queryByText(/正在切换/)).toBeNull();
  });

  it("loads both status cards in parallel and preserves an API key draft across background refetch", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve(
        jsonResponse(
          url === "/api/mirror/status"
            ? mirrorStatus
            : url.includes("/garmin/")
              ? garminStatus
              : integrationStatus,
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();

    const keyInput = (await screen.findByLabelText(
      "API Key",
    )) as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "anonymous-draft" } });
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(keyInput.value).toBe("anonymous-draft"));
    expect(screen.getByText("GitHub 私人仓库")).toBeTruthy();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
      expect.arrayContaining([
        "/api/trackers/knee-rehab/integrations/xunji/credential",
        "/api/trackers/knee-rehab/integrations/garmin/credential",
        "/api/mirror/status",
      ]),
    );
  });
});
