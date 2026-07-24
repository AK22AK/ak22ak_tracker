// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GarminIntegrationCard } from "@/components/garmin-integration-card";

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

describe("Garmin token-only settings flow", () => {
  it("imports a local file without displaying or retaining its token", async () => {
    const connected = {
      ...disconnected,
      state: "needs_validation" as const,
      updatedAt: "2026-07-24T02:00:00.000Z",
    };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(connected));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <GarminIntegrationCard
        trackerKey="anonymous-tracker"
        initialStatus={disconnected}
      />,
    );

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

  it("renders only the whitelisted single-day activity summary", async () => {
    const imported = {
      ...disconnected,
      state: "needs_validation" as const,
      updatedAt: "2026-07-24T02:00:00.000Z",
    };
    const response = {
      provider: "garmin",
      date: "2026-07-24",
      activities: [
        {
          activityType: "running",
          startedAt: "2026-07-24T00:30:00.000Z",
          durationSeconds: 1_800,
          distanceMeters: 3_000,
          averagePaceSecondsPerKilometer: 360,
          averageHeartRateBpm: 128,
        },
      ],
      connection: {
        ...imported,
        state: "connected",
        verifiedAt: "2026-07-24T02:00:00.000Z",
      },
    };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(response));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <GarminIntegrationCard
        trackerKey="anonymous-tracker"
        initialStatus={imported}
      />,
    );

    fireEvent.change(screen.getByLabelText("验证日期"), {
      target: { value: "2026-07-24" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览这一天" }));

    await screen.findByText("running");
    expect(screen.getByText(/3.00 km/)).toBeTruthy();
    expect(screen.getByText(/平均心率 128/)).toBeTruthy();
    expect(screen.getByText(/尚未保存活动数据/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("providerRecordId");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows a safe refresh action without exposing Provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "authentication" }, { status: 422 }),
      ),
    );
    render(
      <GarminIntegrationCard
        trackerKey="anonymous-tracker"
        initialStatus={{ ...disconnected, state: "needs_validation" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "预览这一天" }));

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
    render(
      <GarminIntegrationCard
        trackerKey="anonymous-tracker"
        initialStatus={{ ...disconnected, state: "connected" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "预览这一天" }));

    await screen.findByText("验证日期不能晚于今天。");
    expect(screen.queryByText(/Garmin 暂时无法连接/)).toBeNull();
    expect(screen.queryByText(/本次验证没有完成/)).toBeNull();
  });
});
