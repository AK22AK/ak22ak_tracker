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

import { ResumptionAssessmentClient } from "@/components/resumption-assessment-client";
import { schemaVersion } from "@/domain/schemas";

const assessmentId = "019c0000-0000-7000-8000-000000000301";
const planId = "019c0000-0000-7000-8000-000000000302";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function assessment() {
  return {
    schemaVersion,
    id: assessmentId,
    trackerKey: "knee-rehab",
    trigger: {
      type: "pause",
      id: "019c0000-0000-7000-8000-000000000303",
      startDate: "2026-07-20",
      endDate: "2026-07-22",
      interruptionDays: 3,
      pausedDays: 3,
      restrictedDays: 0,
    },
    basePlanVersion: {
      id: planId,
      version: 2,
      effectiveFrom: "2026-07-01",
    },
    timelineHead: {
      id: planId,
      version: 2,
      effectiveFrom: "2026-07-01",
    },
    shiftAvailability: {
      allowed: true,
      reason: null,
      blockingPlanVersion: null,
    },
    planningTimeZone: "Asia/Shanghai",
    createdAt: "2026-07-22T08:00:00.000Z",
    recommendedEffectiveFrom: "2026-07-23",
    shiftDays: 3,
    lastConfirmedTraining: null,
    futureTasks: [
      {
        taskInstanceId: "019c0000-0000-7000-8000-000000000304",
        taskDefinitionId: "anonymous-future-task",
        title: "Anonymous future task",
        category: "general",
        scheduledOn: "2026-07-23",
        status: "planned",
      },
    ],
    shiftPreview: [
      {
        taskDefinitionId: "anonymous-future-task",
        title: "Anonymous future task",
        from: "2026-07-23",
        to: "2026-07-26",
      },
    ],
    status: "pending",
    decision: null,
    decidedAt: null,
    appliedPlanVersionId: null,
  } as const;
}

function renderClient() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <ResumptionAssessmentClient assessmentId={assessmentId} />
    </QueryClientProvider>,
  );
}

describe("resumption assessment UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a neutral interruption summary and explicit shift diff", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(assessment())));
    renderClient();

    expect(await screen.findByText("确认中断后怎样继续")).toBeTruthy();
    expect(
      screen.getByText(
        "暂停和受限日期不会计为漏练，替代训练也不会直接勾选原任务。",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /顺延后续安排/ }));
    expect(screen.getByText("Anonymous future task")).toBeTruthy();
    expect(screen.getByText(/7月23日周四 → 7月26日周日/)).toBeTruthy();
  });

  it("keeps the decision draft and stable command id after a failed save", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(assessment()))
      .mockResolvedValueOnce(response({ error: "temporary_failure" }, 500))
      .mockResolvedValueOnce(
        response({
          commandId: "019c0000-0000-7000-8000-000000000399",
          replayed: false,
          status: "shifted",
          assessmentId,
          appliedPlanVersionId: "019c0000-0000-7000-8000-000000000398",
          replacementAssessmentId: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderClient();

    await screen.findByText("确认中断后怎样继续");
    fireEvent.click(screen.getByRole("radio", { name: /顺延后续安排/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认接续方式" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "选择仍然保留",
    );
    expect(
      (
        screen.getByRole("radio", {
          name: /顺延后续安排/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "确认接续方式" }));
    expect(await screen.findByText("后续安排已顺延")).toBeTruthy();
    const firstBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(secondBody.commandId).toBe(firstBody.commandId);
    expect(secondBody.newPlanVersionId).toBe(firstBody.newPlanVersionId);
    expect(secondBody.replacementAssessmentId).toBe(
      firstBody.replacementAssessmentId,
    );
  });

  it("does not create a shift request when keeping the original plan", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(assessment()))
      .mockResolvedValueOnce(
        response({
          commandId: "019c0000-0000-7000-8000-000000000397",
          replayed: false,
          status: "kept_original",
          assessmentId,
          appliedPlanVersionId: null,
          replacementAssessmentId: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderClient();

    await screen.findByText("确认中断后怎样继续");
    fireEvent.click(screen.getByRole("button", { name: "确认接续方式" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body.decision).toBe("keep_original");
    expect(body).not.toHaveProperty("newPlanVersionId");
  });

  it("disables shift when a future plan version already exists", async () => {
    const blocked = assessment();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          ...blocked,
          timelineHead: {
            id: "019c0000-0000-7000-8000-000000000390",
            version: 3,
            effectiveFrom: "2026-08-01",
          },
          shiftAvailability: {
            allowed: false,
            reason: "future_plan_version_exists",
            blockingPlanVersion: {
              id: "019c0000-0000-7000-8000-000000000390",
              version: 3,
              effectiveFrom: "2026-08-01",
            },
          },
        }),
      ),
    );
    renderClient();

    const shift = await screen.findByRole("radio", {
      name: /顺延后续安排/,
    });
    expect((shift as HTMLInputElement).disabled).toBe(true);
    expect(
      screen.getByText(/后面的训练已有单独安排，暂时不能顺延/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("radio", {
          name: /按原计划继续/,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(false);
  });
});
