"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  type MouseEvent,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import { markStartupMilestone } from "@/client/startup-performance";
import {
  RootTabLocationProvider,
  type RootTabLocation,
} from "@/client/root-tab-location";
import { useOfflineCommands } from "@/offline/offline-command-context";

import { BottomNav } from "./bottom-nav";
import { ProtectedStartupShell } from "./protected-startup-shell";
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

type RootNavigationIntent = {
  generation: number;
  tab: RootTab;
  url: string;
};

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

function internalNonRootHref(event: MouseEvent<HTMLDivElement>) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null;
  }
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.target || anchor.hasAttribute("download")) return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin || exactRootTab(url.pathname)) {
    return null;
  }
  return `${url.pathname}${url.search}`;
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
  const router = useRouter();
  const { commands } = useOfflineCommands();
  const [initialTab] = useState<RootTab | null>(() => exactRootTab(pathname));
  const [activeTab, setActiveTab] = useState<RootTab>(
    initialTab ?? navigationTab(pathname),
  );
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<RootTab>>(
    () => new Set(initialTab ? [initialTab] : []),
  );
  const [showGeometryGate, setShowGeometryGate] = useState(true);
  const [rootTabLocation, setRootTabLocation] =
    useState<RootTabLocation | null>(null);
  const [rootNavigationIntent, setRootNavigationIntent] =
    useState<RootNavigationIntent | null>(null);
  const [standaloneFeedbackEntry] = useState(pathname === "/feedback");
  const [initialChildren] = useState<React.ReactNode>(() => children);
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef(activeTab);
  const pendingNonRootHrefRef = useRef<string | null>(null);
  const rootNavigationIntentRef = useRef<RootNavigationIntent | null>(null);
  const rootNavigationGenerationRef = useRef(0);
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
      scrollPositionsRef.current[currentTab] =
        contentRef.current?.scrollTop ?? 0;
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
      setRootTabLocation((current) => ({
        url,
        revision: (current?.revision ?? 0) + 1,
      }));
      window.requestAnimationFrame(() => {
        const target = scrollPositionsRef.current[tab];
        if (
          contentRef.current &&
          Math.abs(contentRef.current.scrollTop - target) > 1
        ) {
          contentRef.current.scrollTo({ top: target, behavior: "auto" });
        }
      });
    },
    [],
  );

  useEffect(() => {
    const publishShellReady = () => {
      setShowGeometryGate(false);
      shellRef.current?.setAttribute("data-app-shell-ready", "true");
      markStartupMilestone("shell-hydrated");
    };
    if (
      document.documentElement.getAttribute("data-ak-shell-geometry-ready") !==
      "false"
    ) {
      publishShellReady();
      return;
    }
    window.addEventListener("ak-shell-geometry-ready", publishShellReady, {
      once: true,
    });
    return () =>
      window.removeEventListener("ak-shell-geometry-ready", publishShellReady);
  }, []);

  useEffect(() => {
    const rootTab = exactRootTab(pathname);
    const intent = rootNavigationIntentRef.current;
    if (intent) {
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      if (rootTab !== intent.tab || currentUrl !== intent.url) return;
      rootNavigationIntentRef.current = null;
      pendingNonRootHrefRef.current = null;
      setRootNavigationIntent(null);
    }
    if (rootTab) {
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      tabUrlsRef.current[rootTab] = currentUrl;
      if (activeTabRef.current !== rootTab) {
        activateTab(rootTab, currentUrl);
      } else {
        setVisitedTabs((current) => {
          if (current.has(rootTab)) return current;
          const next = new Set(current);
          next.add(rootTab);
          return next;
        });
      }
      return;
    }
    pendingNonRootHrefRef.current = null;
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
      const renderedRootTab = exactRootTab(pathname);
      const browserRootTab = exactRootTab(window.location.pathname);
      const hasOlderNonRootNavigation =
        pendingNonRootHrefRef.current !== null ||
        rootNavigationIntentRef.current !== null ||
        renderedRootTab === null ||
        browserRootTab === null;
      if (
        tab === activeTabRef.current &&
        renderedRootTab === tab &&
        browserRootTab === tab &&
        !hasOlderNonRootNavigation
      ) {
        return;
      }
      const currentUrl =
        renderedRootTab !== null && browserRootTab === renderedRootTab
          ? `${window.location.pathname}${window.location.search}`
          : tabUrlsRef.current[activeTabRef.current];
      const targetUrl = tabUrlsRef.current[tab] || href;
      if (hasOlderNonRootNavigation) {
        const intent = {
          generation: rootNavigationGenerationRef.current + 1,
          tab,
          url: targetUrl,
        } satisfies RootNavigationIntent;
        rootNavigationGenerationRef.current = intent.generation;
        rootNavigationIntentRef.current = intent;
        pendingNonRootHrefRef.current = null;
        // Keep the persistent host as the immediate visual source of truth.
        // App Router navigation is intentionally started only after this local
        // state is committed, otherwise its transition can defer Activity's
        // visible panel and leave the preceding detail/root panel on screen.
        flushSync(() => {
          setRootNavigationIntent(intent);
          activateTab(tab, targetUrl, currentUrl);
        });
        window.history.pushState(null, "", targetUrl);
        router.replace(targetUrl, { scroll: false });
        return;
      }
      window.history.pushState(null, "", targetUrl);
      activateTab(tab, targetUrl, currentUrl);
    },
    [activateTab, pathname, router],
  );

  const rootTab = exactRootTab(pathname);
  const interceptedFeedback =
    pathname === "/feedback" &&
    !standaloneFeedbackEntry &&
    visitedTabs.has("today");
  const showTabHost =
    rootNavigationIntent !== null || rootTab !== null || interceptedFeedback;
  const activePath = showTabHost ? rootTabPaths[activeTab] : pathname;
  const renderedTabs =
    rootTab !== null && !visitedTabs.has(rootTab)
      ? new Set([...visitedTabs, rootTab])
      : visitedTabs;

  return (
    <RootTabLocationProvider value={rootTabLocation}>
      <div
        ref={shellRef}
        className="protected-app-shell"
        data-app-shell-ready="false"
      >
        {showGeometryGate ? (
          <div className="protected-app-geometry-gate">
            <ProtectedStartupShell />
          </div>
        ) : null}
        <PwaUpdatePrompt pendingCommandCount={commands.length} />
        <div
          ref={contentRef}
          className="protected-app-content"
          data-app-shell-content
          onClickCapture={(event) => {
            const href = internalNonRootHref(event);
            if (href) pendingNonRootHrefRef.current = href;
          }}
        >
          <div hidden={!showTabHost} data-tab-host="persistent">
            {([...renderedTabs] as RootTab[]).map((tab) => (
              <Activity
                key={tab}
                mode={activeTab === tab ? "visible" : "hidden"}
              >
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
        </div>
        <BottomNav activePath={activePath} onNavigate={navigate} />
      </div>
    </RootTabLocationProvider>
  );
}
