const bootstrapSource = String.raw`
(() => {
  const enabledKey = "ak.shellDiagnostics.enabled.v1";
  const reportKey = "ak.shellDiagnostics.report.v1";
  let enabled = false;
  try {
    const preference = localStorage.getItem(enabledKey);
    const queryEnabled =
      new URLSearchParams(location.search).get("ak-shell-diagnostics") === "1";
    const standalone =
      matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true;
    enabled =
      preference === "1" ||
      queryEnabled ||
      (preference !== "0" && standalone);
    if (queryEnabled) localStorage.setItem(enabledKey, "1");
  } catch {}
  if (!enabled) return;

  const round = (value) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value * 100) / 100
      : null;
  const displayMode = () => {
    if (matchMedia("(display-mode: standalone)").matches) return "standalone";
    if (matchMedia("(display-mode: fullscreen)").matches) return "fullscreen";
    if (matchMedia("(display-mode: minimal-ui)").matches) return "minimal-ui";
    return "browser";
  };
  const rect = (element) => {
    if (!element) return null;
    const value = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      top: round(value.top),
      right: round(value.right),
      bottom: round(value.bottom),
      left: round(value.left),
      width: round(value.width),
      height: round(value.height),
      display: style.display,
      position: style.position,
      heightStyle: style.height,
      minHeight: style.minHeight,
      overflowY: style.overflowY,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      marginTop: style.marginTop,
      marginBottom: style.marginBottom,
      gridTemplateRows: style.gridTemplateRows,
    };
  };
  const meta = (name) =>
    document.querySelector('meta[name="' + name + '"]')?.getAttribute("content") ?? null;
  const unitProbe = (height) => {
    if (!document.body) return null;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.setAttribute("data-ak-shell-diagnostics-probe", "");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;inset:auto;width:1px;height:" +
      height +
      ";";
    document.body.append(probe);
    const value = round(probe.getBoundingClientRect().height);
    probe.remove();
    return value;
  };
  const safeAreaProbe = () => {
    if (!document.body) return null;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.setAttribute("data-ak-shell-diagnostics-probe", "");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;inset:auto;width:1px;height:env(safe-area-inset-bottom);";
    document.body.append(probe);
    const value = round(probe.getBoundingClientRect().height);
    probe.remove();
    return value;
  };

  const report = {
    schemaVersion: 1,
    startedAtEpochMs: Date.now(),
    timeOrigin: round(performance.timeOrigin),
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      displayMode: displayMode(),
      navigatorStandalone:
        typeof navigator.standalone === "boolean" ? navigator.standalone : null,
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      viewportMeta: meta("viewport"),
      statusBarStyle: meta("apple-mobile-web-app-status-bar-style"),
    },
    layoutShifts: [],
    events: [],
  };

  let lastSignature = "";
  let framePending = false;
  const persist = () => {
    try {
      localStorage.setItem(reportKey, JSON.stringify(report));
    } catch {}
  };
  const capture = (reason, force = false) => {
    const visual = window.visualViewport;
    const shell = document.querySelector(".protected-app-shell");
    const content = document.querySelector("[data-app-shell-content]");
    const nav = document.querySelector(".bottom-nav");
    const startup = document.querySelector("[data-startup-shell='true']");
    const rootCandidates = [
      shell,
      startup,
      ...[...(document.body?.children ?? [])],
    ];
    const root =
      rootCandidates.find(
        (element) =>
          element &&
          element.tagName !== "SCRIPT" &&
          !element.hidden &&
          getComputedStyle(element).display !== "none" &&
          element.getBoundingClientRect().width > 0 &&
          element.getBoundingClientRect().height > 0 &&
          !element.hasAttribute("data-ak-shell-diagnostics-probe"),
      ) ??
      null;
    const event = {
      at: round(performance.now()),
      reason,
      document: {
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        fontsStatus: document.fonts?.status ?? null,
      },
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        pageXOffset: round(window.pageXOffset),
        pageYOffset: round(window.pageYOffset),
        documentClientWidth: document.documentElement.clientWidth,
        documentClientHeight: document.documentElement.clientHeight,
        visualViewportWidth: round(visual?.width),
        visualViewportHeight: round(visual?.height),
        visualViewportOffsetTop: round(visual?.offsetTop),
        visualViewportOffsetLeft: round(visual?.offsetLeft),
        visualViewportPageTop: round(visual?.pageTop),
        visualViewportPageLeft: round(visual?.pageLeft),
        scale: round(visual?.scale),
        vh: unitProbe("100vh"),
        svh: unitProbe("100svh"),
        dvh: unitProbe("100dvh"),
        safeAreaInsetBottom: safeAreaProbe(),
      },
      state: {
        displayMode: displayMode(),
        startupShellPresent: Boolean(startup),
        protectedShellPresent: Boolean(shell),
        protectedShellReady: shell?.getAttribute("data-app-shell-ready") ?? null,
      },
      elements: {
        documentElement: rect(document.documentElement),
        body: rect(document.body),
        root: rect(root),
        startup: rect(startup),
        shell: rect(shell),
        content: rect(content),
        nav: rect(nav),
      },
    };
    const signature = JSON.stringify({
      viewport: event.viewport,
      state: event.state,
      elements: event.elements,
    });
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    if (report.events.length < 120) report.events.push(event);
    persist();
  };
  const schedule = (reason) => {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      capture(reason);
    });
  };

  capture("bootstrap", true);
  addEventListener("DOMContentLoaded", () => capture("dom-content-loaded", true), {
    once: true,
  });
  addEventListener("load", () => capture("window-load", true), { once: true });
  addEventListener("pageshow", () => capture("page-show", true));
  addEventListener("resize", () => schedule("window-resize"));
  addEventListener("orientationchange", () => schedule("orientation-change"));
  document.addEventListener("visibilitychange", () =>
    capture("visibility-change", true),
  );
  window.visualViewport?.addEventListener("resize", () =>
    schedule("visual-viewport-resize"),
  );
  window.visualViewport?.addEventListener("scroll", () =>
    schedule("visual-viewport-scroll"),
  );
  const isDiagnosticsProbe = (node) =>
    node instanceof Element &&
    (node.hasAttribute("data-ak-shell-diagnostics-probe") ||
      Boolean(node.closest("[data-ak-shell-diagnostics-probe]")));
  new MutationObserver((records) => {
    const onlyProbeChanges = records.every((record) => {
      if (record.type === "attributes") return isDiagnosticsProbe(record.target);
      return [...record.addedNodes, ...record.removedNodes].every(
        (node) => node.nodeType === Node.TEXT_NODE || isDiagnosticsProbe(node),
      );
    });
    if (!onlyProbeChanges) schedule("layout-tree-change");
  }).observe(
    document.documentElement,
    { attributes: true, childList: true, subtree: true },
  );
  if (typeof PerformanceObserver === "function") {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (report.layoutShifts.length >= 40) break;
          report.layoutShifts.push({
            at: round(entry.startTime),
            value: round(entry.value),
            hadRecentInput: Boolean(entry.hadRecentInput),
          });
        }
        persist();
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
  }
})();
`;

export function ShellViewportDiagnosticsBootstrap() {
  return (
    <script
      id="ak-shell-viewport-diagnostics"
      dangerouslySetInnerHTML={{ __html: bootstrapSource }}
    />
  );
}
