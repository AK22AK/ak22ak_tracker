// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trackerQueryKeys } from "@/client/query-keys";
import { FeedbackFlowClient } from "@/components/feedback-flow";
import type { TodayAggregate } from "@/domain/api-contracts";

const navigation = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));
vi.mock("@/domain/planning-time", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/domain/planning-time")>();
  return {
    ...original,
    localDateInTimeZone: () => "2026-07-19",
  };
});

const policyId = "019c0000-0000-7000-8000-000000000201";

function aggregate(): TodayAggregate {
  return {
    tracker: {
      key: "knee-rehab",
      name: "Anonymous Tracker",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    },
    targetDate: "2026-07-19",
    plan: {
      id: "019c0000-0000-7000-8000-000000000202",
      version: 1,
      effectiveFrom: "2026-07-01",
    },
    day: {
      state: "ready",
      trackerName: "Anonymous Tracker",
      startDate: "2026-07-01",
      planVersion: 1,
      tasks: [],
      feedbackCount: 0,
      feedbacks: [],
      externalTrainingRecords: [],
    },
    safetyPolicy: {
      schemaVersion: "1.0.0",
      policyId,
      trackerKey: "knee-rehab",
      version: 1,
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      createdBy: "import",
      rules: [
        {
          id: "anonymous-red-flag",
          outcome: "red",
          match: "any",
          conditions: [
            {
              operator: "equals",
              field: "mechanicalSymptoms",
              value: true,
            },
            { operator: "equals", field: "swelling", value: "obvious" },
          ],
        },
        {
          id: "anonymous-caution",
          outcome: "yellow",
          match: "any",
          conditions: [
            {
              operator: "max_number_gte",
              fields: ["leftPain", "rightPain"],
              value: 5,
            },
            { operator: "equals", field: "swelling", value: "mild" },
          ],
        },
      ],
      hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    execution: {
      context: null,
      day: null,
      alternatives: [],
      safety: { blocked: false, reason: null },
    },
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function savedResult(safetyLevel: "green" | "yellow" | "red") {
  return {
    id: "019c0000-0000-7000-8000-000000000203",
    safetyLevel,
    replayed: false,
    safetyPolicy: {
      policyId,
      version: 1,
      hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    clientPolicyOutdated: false,
  };
}

function renderFlow(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", {
    randomUUID: () => "019c0000-0000-7000-8000-000000000204",
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <FeedbackFlowClient presentation="page" />
    </QueryClientProvider>,
  );
  return queryClient;
}

function renderOverlay(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <div className="protected-app-shell" data-testid="underlying-shell">
      <Link href="/feedback" autoFocus>
        底层反馈入口
      </Link>
    </div>,
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <FeedbackFlowClient presentation="overlay" />
    </QueryClientProvider>,
  );
}

function providerFetch(safetyLevel: "green" | "yellow" | "red") {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "POST"
      ? jsonResponse(savedResult(safetyLevel))
      : jsonResponse(aggregate()),
  );
}

describe("feedback full-screen flow", () => {
  afterEach(() => {
    cleanup();
    navigation.back.mockReset();
    navigation.push.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["green", "绿灯"],
    ["yellow", "黄灯"],
    ["red", "红灯"],
  ] as const)(
    "keeps the %s result on a dedicated result screen",
    async (safetyLevel, label) => {
      const fetchMock = providerFetch(safetyLevel);
      renderFlow(fetchMock);

      await screen.findByRole("heading", { name: "记录身体反馈" });
      if (safetyLevel === "yellow") {
        fireEvent.change(screen.getByLabelText("右膝疼痛（0–10）"), {
          target: { value: "5" },
        });
      }
      if (safetyLevel === "red") {
        fireEvent.click(
          screen.getByRole("checkbox", {
            name: "卡锁、伸不直或打软腿",
          }),
        );
      }

      expect(screen.getByText(`当前输入预判：${label}`)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "保存反馈" }));

      expect(
        await screen.findByRole("heading", { name: "反馈已保存" }),
      ).toBeTruthy();
      expect(screen.getByRole("heading", { name: label })).toBeTruthy();
      expect(screen.getByRole("button", { name: "返回今日" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "继续添加反馈" })).toBeTruthy();
      expect(navigation.back).not.toHaveBeenCalled();
    },
  );

  it("keeps every field and the command id when a failed submission is retried", async () => {
    let postCount = 0;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "POST") return jsonResponse(aggregate());
        postCount += 1;
        return postCount === 1
          ? jsonResponse({}, 503)
          : jsonResponse(savedResult("red"));
      },
    );
    renderFlow(fetchMock);

    await screen.findByRole("heading", { name: "记录身体反馈" });
    fireEvent.change(screen.getByLabelText("左膝疼痛（0–10）"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("右膝疼痛（0–10）"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("肿胀"), {
      target: { value: "obvious" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "僵硬" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "跛行或无法正常负重" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "固定骨性位置疼痛" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "夜间或静息痛加重" }));
    fireEvent.change(screen.getByLabelText("主观补充"), {
      target: { value: "匿名测试草稿" },
    });

    fireEvent.click(screen.getByRole("button", { name: "保存反馈" }));
    expect(
      await screen.findByText("尚未保存，请检查网络后重试。"),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("主观补充") as HTMLTextAreaElement).value,
    ).toBe("匿名测试草稿");

    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    expect(
      await screen.findByRole("heading", { name: "反馈已保存" }),
    ).toBeTruthy();

    const posts = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(posts).toHaveLength(2);
    const firstBody = JSON.parse(String(posts[0]?.[1]?.body));
    const secondBody = JSON.parse(String(posts[1]?.[1]?.body));
    expect(firstBody.commandId).toBe(secondBody.commandId);
    expect(firstBody).toMatchObject({
      leftPain: 3,
      rightPain: 4,
      swelling: "obvious",
      stiffness: true,
      weightBearingIssue: true,
      localizedBonePain: true,
      nightOrRestPain: true,
      note: "匿名测试草稿",
    });
  });

  it("prevents a slow double submission", async () => {
    let resolvePost!: (response: Response) => void;
    const postResponse = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST" ? postResponse : jsonResponse(aggregate()),
    );
    renderFlow(fetchMock);

    await screen.findByRole("heading", { name: "记录身体反馈" });
    const submit = screen.getByRole("button", { name: "保存反馈" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    await act(async () => {
      resolvePost(jsonResponse(savedResult("green")));
      await postResponse;
    });
    expect(
      await screen.findByRole("heading", { name: "反馈已保存" }),
    ).toBeTruthy();
  });

  it("updates the today summary before returning to the preserved page", async () => {
    const fetchMock = providerFetch("yellow");
    const queryClient = renderFlow(fetchMock);

    await screen.findByRole("heading", { name: "记录身体反馈" });
    fireEvent.change(screen.getByLabelText("右膝疼痛（0–10）"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存反馈" }));
    await screen.findByRole("heading", { name: "反馈已保存" });

    const cached = queryClient.getQueryData<TodayAggregate>(
      trackerQueryKeys.today("knee-rehab", "2026-07-19"),
    );
    expect(cached?.day.feedbackCount).toBe(1);
    expect(cached?.day.feedbacks[0]?.safetyLevel).toBe("yellow");

    fireEvent.click(screen.getByRole("button", { name: "返回今日" }));
    expect(navigation.push).toHaveBeenCalledWith("/", { scroll: false });
  });

  it("closes the intercepted flow with browser history so Today stays mounted", async () => {
    renderOverlay(providerFetch("green"));

    await screen.findByRole("heading", { name: "记录身体反馈" });
    fireEvent.click(screen.getByRole("button", { name: "返回今日" }));

    expect(navigation.back).toHaveBeenCalledOnce();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("removes the preserved Today shell from focus and the accessibility tree while overlaid", async () => {
    const view = renderOverlay(providerFetch("green"));
    const shell = screen.getByTestId("underlying-shell");

    const back = await screen.findByRole("button", { name: "返回今日" });
    expect(shell.hasAttribute("inert")).toBe(true);
    expect(shell.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("dialog", { name: "记录身体反馈" })).toBeTruthy();
    expect(document.activeElement).toBe(back);

    view.unmount();
    expect(shell.hasAttribute("inert")).toBe(false);
    expect(shell.hasAttribute("aria-hidden")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(
      shell.querySelector('a[href="/feedback"]'),
    );
  });

  it("keeps loading and error states inside the isolated dialog", async () => {
    let resolveLoad!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveLoad = resolve;
    });
    const loadingView = renderOverlay(vi.fn(() => pendingResponse));
    const shell = screen.getByTestId("underlying-shell");
    const loadingDialog = screen.getByRole("dialog", {
      name: "正在准备反馈表单",
    });

    expect(shell.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(loadingDialog);
    await act(async () => {
      resolveLoad(jsonResponse({}, 503));
      await pendingResponse;
    });

    expect(
      await screen.findByRole("dialog", {
        name: "反馈表单暂时无法加载",
      }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "重试加载" }),
    );
    expect(shell.hasAttribute("inert")).toBe(true);
    loadingView.unmount();
  });

  it("announces and focuses the saved result without exposing Today", async () => {
    renderOverlay(providerFetch("green"));
    const shell = screen.getByTestId("underlying-shell");

    await screen.findByRole("heading", { name: "记录身体反馈" });
    fireEvent.click(screen.getByRole("button", { name: "保存反馈" }));
    const resultHeading = await screen.findByRole("heading", {
      name: "反馈已保存",
    });

    expect(screen.getByRole("dialog", { name: "反馈已保存" })).toBeTruthy();
    expect(document.activeElement).toBe(resultHeading);
    expect(shell.hasAttribute("inert")).toBe(true);
    expect(shell.getAttribute("aria-hidden")).toBe("true");
  });

  it("starts a clean additional form and preserves an unsaved draft during background refresh", async () => {
    const fetchMock = providerFetch("green");
    const queryClient = renderFlow(fetchMock);

    await screen.findByRole("heading", { name: "记录身体反馈" });
    fireEvent.change(screen.getByLabelText("主观补充"), {
      target: { value: "后台刷新前的匿名草稿" },
    });
    queryClient.setQueryData(
      trackerQueryKeys.today("knee-rehab", "2026-07-19"),
      aggregate(),
    );
    expect(
      (screen.getByLabelText("主观补充") as HTMLTextAreaElement).value,
    ).toBe("后台刷新前的匿名草稿");

    fireEvent.click(screen.getByRole("button", { name: "保存反馈" }));
    await screen.findByRole("heading", { name: "反馈已保存" });
    fireEvent.click(screen.getByRole("button", { name: "继续添加反馈" }));

    expect(
      await screen.findByRole("heading", { name: "记录身体反馈" }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("主观补充") as HTMLTextAreaElement).value,
    ).toBe("");
  });

  it("keeps the prescribed field order", async () => {
    renderFlow(providerFetch("green"));
    const timing = await screen.findByLabelText("反馈时机");
    const leftPain = screen.getByLabelText("左膝疼痛（0–10）");
    const swelling = screen.getByLabelText("肿胀");
    const mechanical = screen.getByRole("checkbox", {
      name: "卡锁、伸不直或打软腿",
    });
    const note = screen.getByLabelText("主观补充");

    expect(
      timing.compareDocumentPosition(leftPain) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      leftPain.compareDocumentPosition(swelling) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      swelling.compareDocumentPosition(mechanical) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      mechanical.compareDocumentPosition(note) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
