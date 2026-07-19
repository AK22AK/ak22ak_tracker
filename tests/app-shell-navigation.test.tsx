// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProtectedAppShell } from "@/components/protected-app-shell";

const navigation = vi.hoisted(() => ({
  pathname: "/calendar",
  push: vi.fn(),
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

  it("selects the target tab and shows its page frame within 100 ms while navigation is still pending", () => {
    vi.useFakeTimers();
    render(
      <ProtectedAppShell>
        <main aria-label="日历页面">日历内容</main>
      </ProtectedAppShell>,
    );

    const startedAt = performance.now();
    fireEvent.click(screen.getByRole("link", { name: /趋势/ }));
    const interactionTime = performance.now() - startedAt;

    expect(interactionTime).toBeLessThan(100);
    expect(
      screen.getByRole("link", { name: /趋势/ }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByRole("main", { name: "趋势页面框架" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeTruthy();
    expect(navigation.push).toHaveBeenCalledWith("/trends", {
      scroll: false,
    });
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
});
