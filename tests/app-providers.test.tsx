// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { todayContentVisibleEvent } from "@/client/startup-performance";

const githubMirrorRecoverySpy = vi.fn(() => null);

vi.mock("@/components/github-mirror-recovery", () => ({
  GitHubMirrorRecovery: () => {
    githubMirrorRecoverySpy();
    return null;
  },
}));

vi.mock("@/offline/clear-private-client-state", () => ({
  registerPrivateQueryStateCleaner: () => () => undefined,
}));

vi.mock("@/offline/private-offline-context", () => ({
  PrivateOfflineIdentityProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <>{children}</>,
}));

vi.mock("@/offline/offline-command-context", () => ({
  OfflineCommandProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { AppProviders } from "@/components/app-providers";

describe("protected AppProviders external recovery boundary", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("keeps GitHub recovery but never posts Provider recovery across app lifecycle events", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppProviders githubUserId="github-user">
        <div>Today</div>
      </AppProviders>,
    );

    expect(screen.getByText("Today")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new Event(todayContentVisibleEvent));
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.history.pushState({}, "", "/settings/garmin");
    });

    expect(githubMirrorRecoverySpy).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
  });
});
