// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GarminIntegrationCard } from "@/components/garmin-integration-card";
import {
  garminActivityTypeLabel,
  type GarminConnectionStatus,
} from "@/domain/garmin";

const disconnected = {
  provider: "garmin" as const,
  state: "not_connected" as const,
  verifiedAt: null,
  updatedAt: null,
  lastErrorCode: null,
};
const credential = {
  schemaVersion: 1,
  client: "python-garminconnect",
  clientVersion: "0.3.6",
  region: "global",
  tokenBundle: JSON.stringify({
    di_token: "anonymous-access-token",
    di_refresh_token: "anonymous-refresh-token",
    di_client_id: "anonymous-client-id",
  }),
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCard(initialStatus: GarminConnectionStatus = disconnected) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <GarminIntegrationCard
        trackerKey="anonymous-tracker"
        initialStatus={initialStatus}
      />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("Garmin token-only settings flow", () => {
  it("imports a local file without displaying or retaining its token", async () => {
    const connected = {
      ...disconnected,
      state: "needs_validation" as const,
      updatedAt: "2026-07-24T02:00:00.000Z",
    };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(connected));
    vi.stubGlobal("fetch", fetchMock);
    renderCard();

    const input = screen.getByLabelText("Token 文件") as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          new File([JSON.stringify(credential)], "anonymous-token.json", {
            type: "application/json",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入并加密保存" }));

    await screen.findByText("待验证");
    expect(screen.getByText(/Token 已加密保存/)).toBeTruthy();
    expect(screen.getByText(/浏览器无法删除本机文件/)).toBeTruthy();
    expect(
      screen.getByText(/rm ~\/.ak22ak_tracker\/garmin-token-bundle.json/),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("anonymous-access-token");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "/api/trackers/anonymous-tracker/integrations/garmin/credential",
    );
    expect(init).toEqual(expect.objectContaining({ method: "PUT" }));
    expect(JSON.parse(String(init?.body))).toEqual({ credential });
    expect(String(init?.body)).not.toContain(".ak22ak_tracker");
  });

  it("persists one selected day and reports only safe result counts", async () => {
    const imported = {
      ...disconnected,
      state: "needs_validation" as const,
      updatedAt: "2026-07-24T02:00:00.000Z",
    };
    const response = {
      provider: "garmin",
      date: "2026-07-24",
      sync: {
        cached: false,
        created: 2,
        changed: 1,
        unchanged: 3,
        recordCount: 6,
        syncedAt: "2026-07-24T02:00:00.000Z",
      },
      connection: {
        ...imported,
        state: "connected",
        verifiedAt: "2026-07-24T02:00:00.000Z",
      },
    };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(response));
    vi.stubGlobal("fetch", fetchMock);
    renderCard(imported);

    fireEvent.change(screen.getByLabelText("同步日期"), {
      target: { value: "2026-07-24" },
    });
    fireEvent.click(screen.getByRole("button", { name: "同步这一天" }));

    expect(await screen.findByText(/已同步 6 条活动/)).toBeTruthy();
    expect(screen.getByText(/新增 2 条、更新 1 条/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("providerRecordId");
    expect(document.body.textContent).not.toContain("anonymous-provider-id");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/trackers/anonymous-tracker/integrations/garmin/sync",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ date: "2026-07-24" }),
      }),
    );
    expect(garminActivityTypeLabel("running")).toBe("跑步");
    expect(garminActivityTypeLabel("anonymous_provider_type")).toBe("其他活动");
  });

  it("shows a safe refresh action without exposing Provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "authentication" }, { status: 422 }),
      ),
    );
    renderCard({ ...disconnected, state: "needs_validation" });

    fireEvent.click(screen.getByRole("button", { name: "同步这一天" }));

    await waitFor(() => expect(screen.getByText("需要更新")).toBeTruthy());
    expect(screen.getByText(/请在本机重新授权后导入/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("private provider");
  });

  it("explains a rejected future date without blaming Garmin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "future_date_not_allowed" }, { status: 400 }),
      ),
    );
    renderCard({ ...disconnected, state: "connected" });

    fireEvent.click(screen.getByRole("button", { name: "同步这一天" }));

    await screen.findByText("同步日期不能晚于今天。");
    expect(screen.queryByText(/Garmin 暂时无法连接/)).toBeNull();
    expect(screen.queryByText(/本次验证没有完成/)).toBeNull();
  });
});
