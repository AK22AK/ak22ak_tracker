// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import Link from "next/link";
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
      <Link href="/settings/garmin" onClick={(event) => event.preventDefault()}>
        打开 Garmin 详情
      </Link>
    </main>
  ),
}));

vi.mock("@/components/trends-client", () => ({
  TrendsClient: () => <main aria-label="趋势页面">趋势缓存内容</main>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

function OpaqueCalendarRouteChildren() {
  return (
    <div data-root-tab-content="calendar">
      <main aria-label="迟到的日历路由内容">迟到的日历路由内容</main>
    </div>
  );
}

describe("protected app shell navigation (P0-05)", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-ak-shell-geometry-ready");
    vi.useRealTimers();
    navigation.pathname = "/calendar";
    window.history.replaceState(null, "", "/calendar");
    navigation.push.mockReset();
  });

  it("keeps protected content behind the startup gate until standalone geometry is ready", () => {
    document.documentElement.setAttribute(
      "data-ak-shell-geometry-ready",
      "false",
    );
    const { container } = render(
      <ProtectedAppShell>
        <main aria-label="日历缓存内容">日历缓存内容</main>
      </ProtectedAppShell>,
    );

    const shell = container.querySelector(".protected-app-shell");
    expect(shell?.getAttribute("data-app-shell-ready")).toBe("false");
    expect(
      container.querySelector(".protected-app-geometry-gate"),
    ).not.toBeNull();

    document.documentElement.setAttribute(
      "data-ak-shell-geometry-ready",
      "true",
    );
    fireEvent(window, new CustomEvent("ak-shell-geometry-ready"));

    expect(shell?.getAttribute("data-app-shell-ready")).toBe("true");
    expect(container.querySelector(".protected-app-geometry-gate")).toBeNull();
  });

  it("shows an uncached target tab's stable content shell in the same event turn", () => {
    render(
      <ProtectedAppShell>
        <main aria-label="日历缓存内容">日历缓存内容</main>
      </ProtectedAppShell>,
    );

    let nextMicrotaskStarted = false;
    queueMicrotask(() => {
      nextMicrotaskStarted = true;
    });
    fireEvent.click(screen.getByRole("link", { name: /趋势/ }));

    // The browser navigation suite owns the real 100 ms wall-clock gate. This
    // jsdom test locks the stronger scheduling invariant without CPU-load flakes.
    expect(nextMicrotaskStarted).toBe(false);
    expect(
      screen.getByRole("link", { name: /趋势/ }).getAttribute("aria-current"),
    ).toBe("page");
    const trendsPage = screen.getByRole("main", { name: "趋势页面" });
    expect(
      within(trendsPage).getByRole("heading", { name: "趋势" }),
    ).toBeTruthy();
    expect(screen.queryByText(/正在切换/)).toBeNull();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("keeps visited tab content, drafts and instances mounted across warm switches", async () => {
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
    expect(screen.getByRole("main", { name: "设置页面" })).toBeTruthy();
    const settings = await screen.findByRole("main", {
      name: "设置缓存内容",
    });
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

  it("routes a later root-tab intent through App Router while a detail navigation is pending", () => {
    navigation.pathname = "/settings";
    window.history.replaceState(null, "", "/settings");
    const view = render(
      <ProtectedAppShell>
        <main aria-label="设置路由 children">设置路由 children</main>
      </ProtectedAppShell>,
    );

    fireEvent.click(screen.getByRole("link", { name: "打开 Garmin 详情" }));
    fireEvent.click(screen.getByRole("link", { name: /今日/ }));

    expect(window.location.pathname).toBe("/");
    expect(screen.getByRole("main", { name: "今日缓存内容" })).toBeTruthy();

    // An older pathname/children publication must not cover the newer root
    // intent while the App Router transition is settling.
    navigation.pathname = "/settings/garmin";
    view.rerender(
      <ProtectedAppShell>
        <main aria-label="Garmin设置">迟到的 Garmin 详情</main>
      </ProtectedAppShell>,
    );
    expect(screen.getByRole("main", { name: "今日缓存内容" })).toBeTruthy();
    expect(screen.queryByRole("main", { name: "Garmin设置" })).toBeNull();
  });

  it("lets the latest rapid root-tab intent replace an earlier escape intent", async () => {
    navigation.pathname = "/settings/account";
    window.history.replaceState(null, "", "/settings/account");
    render(
      <ProtectedAppShell>
        <main aria-label="账号设置">账号详情</main>
      </ProtectedAppShell>,
    );

    fireEvent.click(screen.getByRole("link", { name: /今日/ }));
    fireEvent.click(screen.getByRole("link", { name: /日历/ }));

    expect(navigation.push.mock.calls).toEqual([
      ["/", { scroll: false }],
      ["/calendar", { scroll: false }],
    ]);
    expect(
      await screen.findByRole("main", { name: "日历缓存内容" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /日历/ }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByRole("main", { name: "账号设置" })).toBeNull();
  });

  it("keeps the last of 20 rapid root-tab intents as the single visible truth", async () => {
    navigation.pathname = "/settings/history";
    window.history.replaceState(null, "", "/settings/history");
    render(
      <ProtectedAppShell>
        <main aria-label="历史数据补录设置">历史数据补录详情</main>
      </ProtectedAppShell>,
    );
    const labels = [/今日/, /日历/, /趋势/, /设置/] as const;

    for (let index = 0; index < 20; index += 1) {
      fireEvent.click(
        screen.getByRole("link", { name: labels[index % labels.length] }),
      );
    }

    expect(navigation.push).toHaveBeenCalledTimes(20);
    expect(
      screen.getByRole("link", { name: /设置/ }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      await screen.findByRole("main", { name: "设置缓存内容" }),
    ).toBeTruthy();
    expect(screen.queryByRole("main", { name: "历史数据补录设置" })).toBeNull();
  });

  it("restores a root tab from browser history even while App Router children are stale", async () => {
    navigation.pathname = "/settings/account";
    window.history.replaceState(null, "", "/settings/account");
    render(
      <ProtectedAppShell>
        <main aria-label="账号设置">账号详情</main>
      </ProtectedAppShell>,
    );

    window.history.replaceState(null, "", "/calendar?date=2026-08-03");
    fireEvent(window, new PopStateEvent("popstate"));

    expect(
      await screen.findByRole("main", { name: "日历缓存内容" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /日历/ }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByRole("main", { name: "账号设置" })).toBeNull();
  });

  it("does not bind stale Calendar route children to the Settings pathname", async () => {
    navigation.pathname = "/settings";
    window.history.replaceState(null, "", "/settings");
    render(
      <ProtectedAppShell>
        <OpaqueCalendarRouteChildren />
      </ProtectedAppShell>,
    );

    expect(
      await screen.findByRole("main", { name: "设置缓存内容" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("main", { name: "迟到的日历路由内容" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: /设置/ }).getAttribute("aria-current"),
    ).toBe("page");
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
    window.history.replaceState(null, "", "/feedback");
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
