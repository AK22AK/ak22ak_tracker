const startupPrefix = "ak.startup.";

export const todayContentVisibleEvent = "ak:today-content-visible";

type StartupMilestone = "shell-hydrated" | "today-request" | "today-content";

function measureOnce(name: string, end: number) {
  if (performance.getEntriesByName(name, "measure").length > 0) return;
  try {
    performance.measure(name, { start: 0, end });
  } catch {
    // Performance measurement is observability only and cannot block startup.
  }
}

export function markStartupMilestone(milestone: StartupMilestone) {
  if (typeof performance === "undefined") return;
  const name = `${startupPrefix}${milestone}`;
  let mark = performance.getEntriesByName(name, "mark")[0];
  if (!mark) {
    performance.mark(name);
    mark = performance.getEntriesByName(name, "mark")[0];
  }
  if (mark) {
    measureOnce(`${startupPrefix}document-to-${milestone}`, mark.startTime);
  }
}

export function observeFirstContentfulPaint() {
  if (
    typeof performance === "undefined" ||
    typeof PerformanceObserver === "undefined"
  ) {
    return () => undefined;
  }

  const publish = (entries: PerformanceEntry[]) => {
    const fcp = entries.find(
      (entry) => entry.name === "first-contentful-paint",
    );
    if (!fcp) return false;
    measureOnce(`${startupPrefix}document-to-fcp`, fcp.startTime);
    return true;
  };
  if (publish(performance.getEntriesByType("paint"))) return () => undefined;

  const observer = new PerformanceObserver((list) => {
    if (publish(list.getEntries())) observer.disconnect();
  });
  try {
    observer.observe({ type: "paint", buffered: true });
  } catch {
    return () => undefined;
  }
  return () => observer.disconnect();
}

export function announceTodayContentVisible() {
  markStartupMilestone("today-content");
  window.dispatchEvent(new Event(todayContentVisibleEvent));
}
