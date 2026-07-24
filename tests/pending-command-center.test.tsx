// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PendingCommandCenter } from "@/components/pending-command-center";

const commandHarness = vi.hoisted(() => ({
  commands: [] as Array<Record<string, unknown>>,
  replayNow: vi.fn(async () => undefined),
  discardNeedsAttentionHead: vi.fn(async () => undefined),
}));

vi.mock("@/offline/offline-command-context", () => ({
  useOfflineCommands: () => commandHarness,
}));

function taskCommand(
  id: string,
  status:
    "local_only" | "syncing" | "retryable" | "waiting_auth" | "needs_attention",
  createdAt = "2026-07-20T10:00:00.000Z",
  errorCode?: string,
) {
  return {
    id,
    schemaVersion: 1,
    githubUserId: "10001",
    trackerKey: "knee-rehab",
    kind: "task_update",
    createdAt,
    occurredAt: createdAt,
    localDate: "2026-07-20",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
    attemptCount: 1,
    nextAttemptAt: createdAt,
    lastAttemptAt: createdAt,
    lastErrorCode:
      errorCode ??
      (status === "needs_attention"
        ? "version_conflict"
        : status === "waiting_auth"
          ? "authentication_required"
          : status === "retryable"
            ? "invalid_response"
            : null),
    status,
    sourceVersion: null,
    payload: {
      taskId: "019c0000-0000-7000-8000-000000000903",
      status: "completed",
      actual: null,
      note: "Private note must not be rendered",
      baseStatus: "planned",
      planVersion: 1,
    },
  };
}

describe("P2b-2 pending command center", () => {
  beforeEach(() => {
    commandHarness.commands = [];
    commandHarness.replayNow.mockReset();
    commandHarness.replayNow.mockResolvedValue(undefined);
    commandHarness.discardNeedsAttentionHead.mockReset();
    commandHarness.discardNeedsAttentionHead.mockResolvedValue(undefined);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("describes an empty local list without claiming records were saved", () => {
    render(<PendingCommandCenter trackerKey="knee-rehab" />);

    expect(screen.getByText("当前没有需要同步的内容。")).toBeTruthy();
    expect(screen.queryByText("0 条本机记录")).toBeNull();
    expect(
      screen.queryByText("最早一条处理完成后，后面的记录会继续同步。"),
    ).toBeNull();
    expect(screen.queryByText("任务和身体反馈都已保存。")).toBeNull();
  });

  it("marks the strict queue head and blocks every later record from actions", async () => {
    const headId = "019c0000-0000-7000-8000-000000000901";
    const laterId = "019c0000-0000-7000-8000-000000000902";
    commandHarness.commands = [
      taskCommand(headId, "needs_attention"),
      taskCommand(laterId, "retryable", "2026-07-20T10:01:00.000Z"),
    ];

    render(<PendingCommandCenter trackerKey="knee-rehab" />);

    expect(screen.getByText("2 条本机记录")).toBeTruthy();
    expect(
      screen.getByText("最早一条处理完成后，后面的记录会继续同步。"),
    ).toBeTruthy();
    const records = screen.getAllByRole("article");
    expect(within(records[0]!).getByText("最早一条")).toBeTruthy();
    expect(within(records[1]!).getByText("等待前一条")).toBeTruthy();
    expect(
      within(records[0]!).queryByRole("button", { name: "立即重试" }),
    ).toBeNull();
    expect(
      within(records[0]!).getByRole("button", { name: "放弃本机记录" }),
    ).toBeTruthy();
    expect(within(records[1]!).queryByRole("button")).toBeNull();
    expect(screen.getByText(/线上记录已经变化，请决定是否放弃/)).toBeTruthy();
    expect(screen.queryByText("version_conflict")).toBeNull();
    expect(screen.queryByText(headId)).toBeNull();
    expect(screen.queryByText("Private note must not be rendered")).toBeNull();
  });

  it("cancels without changing the queue and confirms one online head discard", async () => {
    const headId = "019c0000-0000-7000-8000-000000000901";
    commandHarness.commands = [taskCommand(headId, "needs_attention")];
    render(<PendingCommandCenter trackerKey="knee-rehab" />);

    fireEvent.click(screen.getByRole("button", { name: "放弃本机记录" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(commandHarness.discardNeedsAttentionHead).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "放弃本机记录" }));
    fireEvent.click(screen.getByRole("button", { name: "确认放弃" }));
    await waitFor(() =>
      expect(commandHarness.discardNeedsAttentionHead).toHaveBeenCalledOnce(),
    );
    expect(commandHarness.discardNeedsAttentionHead).toHaveBeenCalledWith(
      headId,
    );
  });

  it("does not allow discarding while offline", () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    commandHarness.commands = [
      taskCommand("019c0000-0000-7000-8000-000000000901", "needs_attention"),
    ];
    render(<PendingCommandCenter trackerKey="knee-rehab" />);

    expect(
      (
        screen.getByRole("button", {
          name: "放弃本机记录",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/联网取得最新数据后才能放弃/)).toBeTruthy();
  });

  it.each([
    ["retryable", "立即重试"],
    ["waiting_auth", "重新验证并重试"],
  ] as const)("offers a real manual action for %s", async (status, label) => {
    commandHarness.commands = [
      taskCommand("019c0000-0000-7000-8000-000000000901", status),
    ];
    render(<PendingCommandCenter trackerKey="knee-rehab" />);

    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() =>
      expect(commandHarness.replayNow).toHaveBeenCalledOnce(),
    );
  });

  it("prevents duplicate actions while the queue head is already syncing", () => {
    commandHarness.commands = [
      taskCommand("019c0000-0000-7000-8000-000000000901", "syncing"),
    ];
    render(<PendingCommandCenter trackerKey="knee-rehab" />);

    expect(screen.getByText("正在同步，暂不可重复操作")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /重试|放弃/ })).toBeNull();
  });

  it.each([
    ["invalid_command", "这条本机记录无法按原意提交"],
    ["target_not_found", "对应的计划项目已不可用"],
    ["version_conflict", "线上记录已经变化"],
    ["invalid_response", "这次保存结果无法确认"],
  ] as const)(
    "explains %s without exposing its internal code",
    (code, copy) => {
      commandHarness.commands = [
        taskCommand(
          "019c0000-0000-7000-8000-000000000901",
          code === "invalid_response" ? "retryable" : "needs_attention",
          "2026-07-20T10:00:00.000Z",
          code,
        ),
      ];
      render(<PendingCommandCenter trackerKey="knee-rehab" />);

      expect(screen.getByText(new RegExp(copy))).toBeTruthy();
      expect(screen.queryByText(code)).toBeNull();
    },
  );
});
