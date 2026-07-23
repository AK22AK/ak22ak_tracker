// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProtectedAppShell } from "@/components/protected-app-shell";

const navigation = vi.hoisted(() => ({
  pathname: "/calendar",
  push: vi.fn(),
}));

vi.mock("@/components/today-client", () => ({
  TodayClient: () => <main aria-label="今日缓存内容">今日缓存内容</main>,
}));

vi.mock("@/components/calendar-client", () => ({
  CalendarClient: () => (
    <main aria-label="日历缓存内容">
      日历缓存内容
      <input aria-label="日历草稿" />
    </main>
  ),
}));

vi.mock("@/components/settings-client", () => ({
  SettingsClient: () => (
    <main aria-label="设置缓存内容">
      设置缓存内容
      <input aria-label="设置草稿" />
    </main>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

describe("protected app shell navigation (P0-05)", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    navigation.pathname = "/calendar";
    navigation.push.mockReset();
  });

  it("shows an uncached target tab's stable content shell within 100 ms", () => {
    render(
      <ProtectedAppShell>
        <main aria-label="日历缓存内容">日历缓存内容</main>
      </ProtectedAppShell>,
    );

    const startedAt = performance.now();
    fireEvent.click(screen.getByRole("link", { name: /趋势/ }));
    const interactionTime = performance.now() - startedAt;

    expect(interactionTime).toBeLessThan(100);
    expect(
      screen.getByRole("link", { name: /趋势/ }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByRole("main", { name: "趋势页面" })).toBeTruthy();
    expect(screen.queryByText(/正在切换/)).toBeNull();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("keeps visited tab content, drafts and instances mounted across warm switches", () => {
    render(
      <ProtectedAppShell>
        <main aria-label="日历缓存内容">
          日历缓存内容
          <input aria-label="日历草稿" />
        </main>
      </ProtectedAppShell>,
    );

    expect(screen.getByRole("main", { name: "日历缓存内容" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("日历草稿"), {
      target: { value: "保留日历草稿" },
    });

    const settingsStartedAt = performance.now();
    fireEvent.click(screen.getByRole("link", { name: /设置/ }));
    expect(performance.now() - settingsStartedAt).toBeLessThan(100);
    const settings = screen.getByRole("main", { name: "设置缓存内容" });
    fireEvent.change(within(settings).getByLabelText("设置草稿"), {
      target: { value: "保留设置草稿" },
    });

    const calendarStartedAt = performance.now();
    fireEvent.click(screen.getByRole("link", { name: /日历/ }));
    expect(performance.now() - calendarStartedAt).toBeLessThan(100);
    expect(screen.getByRole("main", { name: "日历缓存内容" })).toBeTruthy();
    expect((screen.getByLabelText("日历草稿") as HTMLInputElement).value).toBe(
      "保留日历草稿",
    );

    fireEvent.click(screen.getByRole("link", { name: /设置/ }));
    expect((screen.getByLabelText("设置草稿") as HTMLInputElement).value).toBe(
      "保留设置草稿",
    );
    expect(screen.queryByText(/正在切换/)).toBeNull();
  });

  it("renders all four product tabs as operable links", () => {
    render(
      <ProtectedAppShell>
        <main>日历内容</main>
      </ProtectedAppShell>,
    );

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/calendar",
      "/trends",
      "/settings",
    ]);
    expect(screen.queryByText("不可用")).toBeNull();
  });

  it("keeps the feedback subflow within the Today tab", () => {
    navigation.pathname = "/feedback";
    render(
      <ProtectedAppShell>
        <main>反馈内容</main>
      </ProtectedAppShell>,
    );

    expect(
      screen.getByRole("link", { name: /今日/ }).getAttribute("aria-current"),
    ).toBe("page");
  });
});
