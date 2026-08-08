// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TodaySyncControl } from "@/components/today-sync-control";

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const result = {
  sources: [
    {
      source: "garmin_activity",
      status: "records",
      recordCount: 1,
      continueAvailable: false,
    },
    {
      source: "garmin_wellness",
      status: "no_records",
      recordCount: 0,
      continueAvailable: false,
    },
    {
      source: "xunji_training",
      status: "needs_credentials",
      recordCount: 0,
      continueAvailable: false,
    },
  ],
};

describe("Today latest-record sync control", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("ignores a second click while one coordinated sync is running", async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((next) => (resolve = next)),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const onCompleted = vi.fn();

    render(
      <TodaySyncControl trackerKey="knee-rehab" onCompleted={onCompleted} />,
    );
    expect(screen.queryByText("训练记录", { exact: true })).toBeNull();
    expect(screen.queryByText("尚未检查新记录", { exact: true })).toBeNull();
    expect(screen.queryByText("同步状态", { exact: true })).toBeNull();
    const button = screen.getByRole("button", { name: "同步外部训练记录" });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "正在同步外部训练记录" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getAllByText("同步中")).toHaveLength(3);

    resolve(response(result));
    expect(await screen.findByText("有记录")).toBeTruthy();
    expect(screen.getByText("本次无新记录")).toBeTruthy();
    expect(screen.getByText("需更新凭证")).toBeTruthy();
    expect(screen.queryByText("训练记录", { exact: true })).toBeNull();
    expect(
      screen.getByText("已更新 1 条，部分来源未完成", { exact: true }),
    ).toBeTruthy();
    expect(screen.queryByText("同步状态", { exact: true })).toBeNull();
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("reacts when the network returns after an offline render", () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);

    render(<TodaySyncControl trackerKey="knee-rehab" onCompleted={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "同步外部训练记录" }),
    ).toHaveProperty("disabled", true);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    fireEvent(window, new Event("online"));

    expect(
      screen.getByRole("button", { name: "同步外部训练记录" }),
    ).toHaveProperty("disabled", false);
  });

  it("projects an empty result as compact status without a records heading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          sources: [
            {
              source: "garmin_activity",
              status: "no_records",
              recordCount: 0,
              continueAvailable: false,
            },
            {
              source: "garmin_wellness",
              status: "no_records",
              recordCount: 0,
              continueAvailable: false,
            },
            {
              source: "xunji_training",
              status: "no_records",
              recordCount: 0,
              continueAvailable: false,
            },
          ],
        }),
      ),
    );
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);

    render(<TodaySyncControl trackerKey="knee-rehab" onCompleted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "同步外部训练记录" }));

    expect(await screen.findByText("没有新的训练记录")).toBeTruthy();
    expect(screen.queryByText("训练记录", { exact: true })).toBeNull();
  });

  it("announces a failed sync as an alert while keeping the trigger available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);

    render(<TodaySyncControl trackerKey="knee-rehab" onCompleted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "同步外部训练记录" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "暂时无法同步",
    );
    expect(
      screen.getByRole("button", { name: "同步外部训练记录" }),
    ).toHaveProperty("disabled", false);
  });
});
