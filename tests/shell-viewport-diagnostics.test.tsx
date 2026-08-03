// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SHELL_DIAGNOSTICS_ENABLED_KEY,
  SHELL_DIAGNOSTICS_REPORT_KEY,
  ShellViewportDiagnosticsPanel,
} from "@/components/shell-viewport-diagnostics-panel";
import { ShellViewportDiagnosticsBootstrap } from "@/components/shell-viewport-diagnostics-bootstrap";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("ShellViewportDiagnosticsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("arms an anonymous capture for the next standalone cold launch", () => {
    render(<ShellViewportDiagnosticsPanel />);

    fireEvent.click(
      screen.getByRole("button", { name: "准备下一次冷启动采集" }),
    );

    expect(localStorage.getItem(SHELL_DIAGNOSTICS_ENABLED_KEY)).toBe("1");
    expect(localStorage.getItem(SHELL_DIAGNOSTICS_REPORT_KEY)).toBeNull();
    expect(screen.getByText("下一次启动将采集匿名布局数据")).toBeTruthy();
  });

  it("shows and copies a captured report without health or account fields", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(
      async () => undefined,
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    localStorage.setItem(
      SHELL_DIAGNOSTICS_REPORT_KEY,
      JSON.stringify({
        schemaVersion: 1,
        environment: {
          displayMode: "standalone",
          screen: { width: 393, height: 852, devicePixelRatio: 3 },
        },
        events: [
          {
            at: 0,
            reason: "bootstrap",
            viewport: { innerHeight: 759 },
            elements: {},
          },
        ],
      }),
    );

    render(<ShellViewportDiagnosticsPanel />);

    expect(screen.getByText("已采集 1 个时间点")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "复制匿名诊断" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = JSON.parse(writeText.mock.calls[0][0]);
    expect(copied.environment.displayMode).toBe("standalone");
    expect(copied).not.toHaveProperty("user");
    expect(copied).not.toHaveProperty("tracker");
    expect(copied).not.toHaveProperty("health");
  });

  it("installs first-frame probes for viewport units, shell geometry, safe area, and CLS", () => {
    render(<ShellViewportDiagnosticsBootstrap />);

    const source = document.querySelector(
      "#ak-shell-viewport-diagnostics",
    )?.textContent;
    expect(source).toContain('unitProbe("100svh")');
    expect(source).toContain('unitProbe("100dvh")');
    expect(source).toContain('get("ak-shell-diagnostics")');
    expect(source).toContain('(preference !== "0" && standalone)');
    expect(source).toContain("safeAreaInsetBottom");
    expect(source).toContain("visualViewportOffsetTop");
    expect(source).toContain("protectedShellReady");
    expect(source).toContain('type: "layout-shift"');
    expect(source).not.toContain("trackerKey");
    expect(source).not.toContain("githubUserId");
  });
});
