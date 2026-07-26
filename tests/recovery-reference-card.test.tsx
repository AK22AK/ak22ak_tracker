// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RecoveryReferenceCard } from "@/components/recovery-reference-card";

afterEach(cleanup);

describe("P5a-2a recovery reference", () => {
  it("distinguishes real zero steps from missing sleep without exposing raw data", () => {
    render(
      <RecoveryReferenceCard
        reference={{
          provider: "garmin",
          localDate: "2026-07-24",
          sourceVersion: 1,
          steps: {
            status: "available",
            totalSteps: 0,
            stepGoal: null,
            observedAt: "2026-07-24T02:00:00.000Z",
            syncedAt: "2026-07-24T02:00:00.000Z",
          },
          sleep: {
            status: "missing",
            sleepStart: null,
            sleepEnd: null,
            totalSleepSeconds: null,
            deepSleepSeconds: null,
            lightSleepSeconds: null,
            remSleepSeconds: null,
            awakeSleepSeconds: null,
            sleepScore: null,
            syncedAt: "2026-07-24T02:00:00.000Z",
          },
        }}
      />,
    );

    expect(screen.getByText("0 步")).toBeTruthy();
    expect(screen.getByText("暂无数据")).toBeTruthy();
    expect(screen.getByText(/仅作恢复参考，不代替身体反馈/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/raw|providerRecordId|Token/);
  });

  it("does not invent zeroes when no record exists", () => {
    render(<RecoveryReferenceCard reference={null} />);
    expect(screen.getByText("暂无睡眠与步数记录")).toBeTruthy();
    expect(document.body.textContent).not.toContain("0 步");
  });
});
