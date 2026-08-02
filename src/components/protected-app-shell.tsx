"use client";

import { usePathname } from "next/navigation";
import {
  Activity,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { markStartupMilestone } from "@/client/startup-performance";
import { useOfflineCommands } from "@/offline/offline-command-context";

import { BottomNav } from "./bottom-nav";
import { PwaUpdatePrompt } from "./service-worker-registration";
import { TodayClient } from "./today-client";

const CalendarClient = lazy(() =>
  import("./calendar-client").then((module) => ({
    default: module.CalendarClient,
  })),
);

const SettingsClient = lazy(() =>
  import("./settings-client").then((module) => ({
    default: module.SettingsClient,
  })),
);

const TrendsClient = lazy(() =>
  import("./trends-client").then((module) => ({
    default: module.TrendsClient,
  })),
);

function TrendsTabLoading() {
  return (
    <main
      className="app-shell page-frame trends-page"
      aria-label="趋势页面"
      aria-busy="true"
    >
      <header className="trend-page-header">
        <div>
          <p className="eyebrow">最近 8 周</p>
          <h1>趋势</h1>
        </div>
      </header>
      <section className="surface-card page-section-loading" role="status">
        正在整理最近记录…
      </section>
    </main>
  );
}

function CalendarTabLoading() {
  return (
    <main className="app-shell page-frame calendar-shell" aria-busy="true">
      <header className="topbar">
        <div>
          <p className="eyebrow">AK Tracker</p>
          <h1>日历</h1>
        </div>
      </header>
      <section className="surface-card page-section-loading" role="status">
        正在打开日历…
      </section>
    </main>
  );
}

function SettingsTabLoading() {
  return (
    <main
      className="app-shell page-frame settings-shell"
      data-settings-shell="true"
      aria-label="设置页面"
      aria-busy="true"
    >
      <header className="topbar">
        <div>
          <p className="eyebrow">AK Tracker</p>
          <h1>设置</h1>
        </div>
      </header>
      <section className="surface-card page-section-loading" role="status">
        正在打开设置…
      </section>
    </main>
  );
}

type RootTab = "today" | "calendar" | "trends" | "settings";

const rootTabPaths: Record<RootTab, string> = {
  today: "/",
  calendar: "/calendar",
  trends: "/trends",
  settings: "/settings",
};

function exactRootTab(pathname: string): RootTab | null {
  const entry = Object.entries(rootTabPaths).find(
    ([, path]) => path === pathname,
  );
  return (entry?.[0] as RootTab | undefined) ?? null;
}

function navigationTab(pathname: string): RootTab {
  if (pathname.startsWith("/calendar")) return "calendar";
  if (pathname.startsWith("/trends")) return "trends";
  if (pathname.startsWith("/settings")) return "settings";
  return "today";
}

function TabContent({
  tab,
  initialTab,
  initialChildren,
}: {
  tab: RootTab;
  initialTab: RootTab | null;
  initialChildren: React.ReactNode;
}) {
  if (tab === initialTab) return initialChildren;
  if (tab === "today") return <TodayClient />;
  if (tab === "calendar") {
    return (
      <Suspense fallback={<CalendarTabLoading />}>
        <CalendarClient />
      </Suspense>
    );
  }
  if (tab === "trends") {
    return (
      <Suspense fallback={<TrendsTabLoading />}>
        <TrendsClient />
      </Suspense>
    );
  }
  if (tab === "settings") {
    return (
      <Suspense fallback={<SettingsTabLoading />}>
        <SettingsClient />
      </Suspense>
    );
  }
  return null;
}

export function ProtectedAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { commands } = useOfflineCommands();
  const [initialTab] = useState<RootTab | null>(() => exactRootTab(pathname));
  const [activeTab, setActiveTab] = useState<RootTab>(
    initialTab ?? navigationTab(pathname),
  );
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<RootTab>>(
    () => new Set(initialTab ? [initialTab] : []),
  );
  const [standaloneFeedbackEntry] = useState(pathname === "/feedback");
  const [initialChildren] = useState<React.ReactNode>(() => children);
  const shellRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef(activeTab);
  const scrollPositionsRef = useRef<Record<RootTab, number>>({
    today: 0,
    calendar: 0,
    trends: 0,
    settings: 0,
  });
  const tabUrlsRef = useRef<Record<RootTab, string>>({ ...rootTabPaths });
  const activateTab = useCallback(
    (tab: RootTab, url: string, previousTabUrl?: string) => {
      const currentTab = activeTabRef.current;
      scrollPositionsRef.current[currentTab] = window.scrollY;
      if (previousTabUrl !== undefined) {
        tabUrlsRef.current[currentTab] = previousTabUrl;
      }
      tabUrlsRef.current[tab] = url;
      activeTabRef.current = tab;
      setVisitedTabs((current) => {
        if (current.has(tab)) return current;
        const next = new Set(current);
        next.add(tab);
        return next;
      });
      setActiveTab(tab);
      window.requestAnimationFrame(() => {
        const target = scrollPositionsRef.current[tab];
        if (Math.abs(window.scrollY - target) > 1) {
          window.scrollTo({ top: target, behavior: "auto" });
        }
      });
    },
    [],
  );

  useEffect(() => {
    shellRef.current?.setAttribute("data-app-shell-ready", "true");
    markStartupMilestone("shell-hydrated");
  }, []);

  useEffect(() => {
    const rootTab = exactRootTab(pathname);
    if (rootTab) {
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      tabUrlsRef.current[rootTab] = currentUrl;
      if (activeTabRef.current !== rootTab) activateTab(rootTab, currentUrl);
      return;
    }
  }, [activateTab, pathname]);

  useEffect(() => {
    if (pathname !== "/feedback" || !standaloneFeedbackEntry) return;
    const state = window.history.state as Record<string, unknown> | null;
    if (state?.__akStandaloneFeedback === true) return;
    window.history.replaceState(
      { ...(state ?? {}), __akStandaloneFeedback: true },
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }, [pathname, standaloneFeedbackEntry]);

  const navigate = useCallback(
    (href: string) => {
      const tab = exactRootTab(href);
      if (!tab) return;
      if (tab === activeTabRef.current && exactRootTab(pathname) === tab)
        return;
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      const targetUrl = tabUrlsRef.current[tab] || href;
      window.history.pushState(null, "", targetUrl);
      activateTab(tab, targetUrl, currentUrl);
    },
    [activateTab, pathname],
  );

  const rootTab = exactRootTab(pathname);
  const interceptedFeedback =
    pathname === "/feedback" &&
    !standaloneFeedbackEntry &&
    visitedTabs.has("today");
  const showTabHost = rootTab !== null || interceptedFeedback;
  const activePath = showTabHost ? rootTabPaths[activeTab] : pathname;

  return (
    <div
      ref={shellRef}
      className="protected-app-shell"
      data-app-shell-ready="false"
    >
      <PwaUpdatePrompt pendingCommandCount={commands.length} />
      <div hidden={!showTabHost} data-tab-host="persistent">
        {([...visitedTabs] as RootTab[]).map((tab) => (
          <Activity key={tab} mode={activeTab === tab ? "visible" : "hidden"}>
            <div data-tab-panel={tab}>
              <TabContent
                tab={tab}
                initialTab={initialTab}
                initialChildren={initialChildren}
              />
            </div>
          </Activity>
        ))}
      </div>
      {showTabHost ? null : children}
      <BottomNav activePath={activePath} onNavigate={navigate} />
    </div>
  );
}
