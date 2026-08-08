// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AkActionRow,
  AkCard,
  AkInsetList,
  AkKonstaProvider,
  AkListRow,
  AkScreenHeader,
  AkStatusChip,
  AkToolbarAction,
} from "@/components/ui/ak-konsta";

describe("UI-R9 Konsta compatibility adapter", () => {
  it("exposes the Today primitives through stable AK semantics", () => {
    const refresh = vi.fn();
    const sync = vi.fn();

    render(
      <AkKonstaProvider>
        <AkScreenHeader
          title="今天"
          subtitle="8月8日 · 周六"
          actions={
            <>
              <AkToolbarAction
                label="刷新今日数据"
                icon="↻"
                variant="tonal"
                onClick={refresh}
              />
              <AkToolbarAction
                label="同步外部训练记录"
                variant="tonal"
                onClick={sync}
              >
                同步
              </AkToolbarAction>
            </>
          }
        />
        <AkCard
          title="今日训练"
          status={<AkStatusChip tone="attention">待完成</AkStatusChip>}
        >
          <AkInsetList>
            <AkListRow title="匿名力量训练" subtitle="匿名动作 · 2 × 8" />
          </AkInsetList>
          <AkActionRow>查看训练说明</AkActionRow>
        </AkCard>
      </AkKonstaProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "今天", level: 1 }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "刷新今日数据" })
        .getAttribute("data-ak-toolbar-variant"),
    ).toBe("tonal");
    expect(
      screen
        .getByRole("button", { name: "同步外部训练记录" })
        .getAttribute("data-ak-toolbar-variant"),
    ).toBe("tonal");
    expect(screen.getByRole("region", { name: "今日训练" })).toBeTruthy();
    expect(screen.getByText("匿名动作 · 2 × 8")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "查看训练说明" })
        .getAttribute("data-ak-action-row"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "刷新今日数据" }));
    fireEvent.click(screen.getByRole("button", { name: "同步外部训练记录" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledOnce();
    expect(document.querySelectorAll("[data-ak-card]")).toHaveLength(1);
    expect(document.querySelector(".protected-app-shell")).toBeNull();
    expect(document.querySelector(".bottom-nav")).toBeNull();
  });

  it("hydrates server markup without console warnings", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <AkKonstaProvider>
        <AkCard title="服务端卡片">首包内容</AkCard>
      </AkKonstaProvider>,
    );
    const errors: unknown[] = [];
    const warnings: unknown[] = [];
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args) => errors.push(args));
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((...args) => warnings.push(args));
    document.body.appendChild(container);

    try {
      const root = hydrateRoot(
        container,
        <AkKonstaProvider>
          <AkCard title="服务端卡片">首包内容</AkCard>
        </AkKonstaProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(errors).toEqual([]);
      expect(warnings).toEqual([]);
      root.unmount();
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      container.remove();
    }
  });

  it("loads the Konsta theme exactly once and avoids internal class selectors", () => {
    const globals = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const todayStyles = readFileSync(
      resolve(process.cwd(), "src/app/ak-today.css"),
      "utf8",
    );
    expect(
      globals.match(/@import ['"]konsta\/react\/theme\.css['"];?/g) ?? [],
    ).toHaveLength(1);
    expect(todayStyles).not.toMatch(/\[class\*=/);
  });
});
