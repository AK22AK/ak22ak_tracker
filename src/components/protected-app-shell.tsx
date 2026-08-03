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
  useSyncExternalStore,
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
  transport: "history" | "router";
  url: string;
};

const rootTabPaths: Record<RootTab, string> = {
  today: "/",
  calendar: "/calendar",
  trends: "/trends",
  settings: "/settings",
};

const browserLocationListeners = new Set<() => void>();
let browserHistoryPatched = false;
let suppressBrowserLocationPublish = false;

function publishBrowserLocation() {
  for (const listener of browserLocationListeners) listener();
}

function ensureBrowserHistoryEvents() {
  if (browserHistoryPatched || typeof window === "undefined") return;
  browserHistoryPatched = true;
  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);
  window.history.pushState = (data, unused, url) => {
    originalPushState(data, unused, url);
    if (!suppressBrowserLocationPublish) publishBrowserLocation();
  };
  window.history.replaceState = (data, unused, url) => {
    originalReplaceState(data, unused, url);
    publishBrowserLocation();
  };
  window.addEventListener("popstate", publishBrowserLocation);
}

function pushRootTabHistory(url: string) {
  suppressBrowserLocationPublish = true;
  try {
    window.history.pushState(null, "", url);
  } finally {
    suppressBrowserLocationPublish = false;
  }
}

function subscribeBrowserLocation(listener: () => void) {
  ensureBrowserHistoryEvents();
  browserLocationListeners.add(listener);
  return () => browserLocationListeners.delete(listener);
}

function getBrowserPathname() {
  return typeof window === "undefined" ? "" : window.location.pathname;
}

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

function TabContent({ tab }: { tab: RootTab }) {
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
  const browserPathname = useSyncExternalStore(
    subscribeBrowserLocation,
    getBrowserPathname,
    () => pathname,
  );
  const [standaloneFeedbackEntry] = useState(pathname === "/feedback");
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
    const browserRootTab = exactRootTab(window.location.pathname);
    const intent = rootNavigationIntentRef.current;
    if (intent) {
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      if (rootTab !== intent.tab || currentUrl !== intent.url) {
        if (intent.transport === "history" && currentUrl !== intent.url) {
          window.history.replaceState(window.history.state, "", intent.url);
        }
        return;
      }
      rootNavigationIntentRef.current = null;
      pendingNonRootHrefRef.current = null;
      setRootNavigationIntent(null);
    }
    if (browserRootTab) {
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      tabUrlsRef.current[browserRootTab] = currentUrl;
      if (activeTabRef.current !== browserRootTab) {
        activateTab(browserRootTab, currentUrl);
      } else {
        setVisitedTabs((current) => {
          if (current.has(browserRootTab)) return current;
          const next = new Set(current);
          next.add(browserRootTab);
          return next;
        });
      }
      return;
    }
    pendingNonRootHrefRef.current = null;
  }, [activateTab, browserPathname, pathname]);

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
        const transport =
          renderedRootTab === null || browserRootTab === null
            ? "router"
            : "history";
        const intent = {
          generation: rootNavigationGenerationRef.current + 1,
          tab,
          transport,
          url: targetUrl,
        } satisfies RootNavigationIntent;
        rootNavigationGenerationRef.current = intent.generation;
        rootNavigationIntentRef.current = intent;
        pendingNonRootHrefRef.current = null;
        // Keep the persistent host as the immediate visual source of truth.
        // A second App Router navigation here can remount the shared shell with
        // a pathname from one transition and children from another. The latest
        // generation instead owns History until usePathname confirms the same
        // complete root URL.
        flushSync(() => {
          setRootNavigationIntent(intent);
          activateTab(tab, targetUrl, currentUrl);
        });
        if (transport === "router") {
          router.push(targetUrl, { scroll: false });
        } else {
          pushRootTabHistory(targetUrl);
        }
        return;
      }
      activateTab(tab, targetUrl, currentUrl);
      pushRootTabHistory(targetUrl);
    },
    [activateTab, pathname, router],
  );

  const browserRootTab = exactRootTab(browserPathname);
  const interceptedFeedback =
    pathname === "/feedback" &&
    !standaloneFeedbackEntry &&
    visitedTabs.has("today");
  const showTabHost =
    rootNavigationIntent !== null ||
    browserRootTab !== null ||
    interceptedFeedback;
  const activePath = showTabHost ? rootTabPaths[activeTab] : pathname;
  const renderedTabs =
    browserRootTab !== null && !visitedTabs.has(browserRootTab)
      ? new Set([...visitedTabs, browserRootTab])
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
                  <TabContent tab={tab} />
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
