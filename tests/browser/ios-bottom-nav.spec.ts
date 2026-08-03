import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

const baseURL = "http://127.0.0.1:4174";
const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const todayAggregate = {
  tracker: {
    key: "knee-rehab",
    name: "Anonymous Tracker",
    startedOn: "2026-07-01",
    planningTimeZone: "Asia/Shanghai",
  },
  targetDate: localDate,
  plan: {
    id: "019c0000-0000-7000-8000-000000000001",
    version: 1,
    effectiveFrom: "2026-07-01",
  },
  day: {
    state: "ready",
    trackerName: "Anonymous Tracker",
    startDate: "2026-07-01",
    planVersion: 1,
    tasks: [],
    feedbackCount: 0,
    feedbacks: [],
    externalTrainingRecords: [],
  },
  safetyPolicy: {
    schemaVersion: "1.0.0",
    policyId: "019c0000-0000-7000-8000-000000000003",
    trackerKey: "knee-rehab",
    version: 1,
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    createdBy: "import",
    rules: [
      {
        id: "anonymous-warning",
        outcome: "yellow",
        match: "all",
        conditions: [{ operator: "number_gte", field: "score", value: 999 }],
      },
    ],
    hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  execution: {
    context: null,
    day: null,
    alternatives: [],
    safety: { blocked: false, reason: null },
  },
};

async function authorize(context: BrowserContext) {
  const token = await encode({
    secret: "anonymous-navigation-browser-test-secret",
    token: { sub: "10001", githubId: "10001", name: "Anonymous User" },
  });
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function mockToday(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/today")) {
      await route.fulfill({ status: 200, json: todayAggregate });
      return;
    }
    await route.fulfill({ status: 200, json: {} });
  });
}

async function simulateIosFirstPaintFixedAnchor(page: Page) {
  await page.addStyleTag({
    content: `
      .protected-app-shell[data-ios-fixed-anchor-fault="true"]
        .bottom-nav[data-ios-fixed-anchor-fault="true"] {
        transform: translateY(7rem);
      }
    `,
  });
  await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".protected-app-shell");
    const nav = document.querySelector<HTMLElement>(".bottom-nav");
    const scrollRoot = document.querySelector<HTMLElement>(
      "[data-app-shell-content]",
    );
    if (!shell || !nav || getComputedStyle(nav).position !== "fixed") return;
    shell.dataset.iosFixedAnchorFault = "true";
    nav.dataset.iosFixedAnchorFault = "true";
    const settle = () => {
      delete shell.dataset.iosFixedAnchorFault;
      delete nav.dataset.iosFixedAnchorFault;
    };
    (scrollRoot ?? window).addEventListener("scroll", settle, { once: true });
  });
}

async function installCapturedStandaloneReplay(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "iPhone",
    });
    Object.defineProperty(window.screen, "width", {
      configurable: true,
      value: 393,
    });
    Object.defineProperty(window.screen, "height", {
      configurable: true,
      value: 852,
    });
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 393,
    });
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      value: 852,
    });
    Object.defineProperty(window, "outerHeight", {
      configurable: true,
      value: 852,
    });

    const replay = { vh: 793, safeBottom: 0 };
    Object.defineProperty(window, "__akStandaloneReplay", {
      configurable: true,
      value: replay,
    });
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const kind = (this as HTMLElement).dataset.akShellGeometryProbe;
      if (kind === "vh" || kind === "safe-bottom") {
        const height = kind === "vh" ? replay.vh : replay.safeBottom;
        return DOMRect.fromRect({ width: 1, height });
      }
      return originalRect.call(this);
    };
  });
}

test("captured standalone sequence fills the final canvas before protected content appears", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await installCapturedStandaloneReplay(page);
  await authorize(page.context());
  await mockToday(page);
  await page.goto("/");

  const shell = page.locator(".protected-app-shell");
  await expect(shell).toBeAttached();
  await expect(shell).toHaveAttribute("data-app-shell-ready", "false");
  await expect(page.locator(".protected-app-geometry-gate")).toBeVisible();
  await expect(
    page.locator("[data-today-content-visible='true']"),
  ).toBeHidden();

  const wrongViewportFrame = await page.screenshot();
  await testInfo.attach("captured-793-gated", {
    body: wrongViewportFrame,
    contentType: "image/png",
  });

  const phasedState = await page.evaluate(() => {
    const replay = (
      window as typeof window & {
        __akStandaloneReplay: { vh: number; safeBottom: number };
      }
    ).__akStandaloneReplay;
    replay.vh = 852;
    const afterViewportUnit = document.documentElement.getAttribute(
      "data-ak-shell-geometry-ready",
    );
    replay.safeBottom = 34;
    document.documentElement.style.setProperty(
      "--ak-replay-safe-bottom",
      "34px",
    );
    return { afterViewportUnit };
  });
  expect(phasedState.afterViewportUnit).toBe("false");
  await page.addStyleTag({
    content:
      ".protected-app-shell .bottom-nav { padding-bottom: var(--ak-replay-safe-bottom) !important; }",
  });

  await expect(shell).toHaveAttribute("data-app-shell-ready", "true");
  await expect(page.locator(".protected-app-geometry-gate")).toHaveCount(0);
  await expect(
    page.locator("[data-today-content-visible='true']"),
  ).toBeVisible();

  const geometry = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".protected-app-shell");
    const nav = document.querySelector<HTMLElement>(".bottom-nav");
    const shellRect = shell?.getBoundingClientRect();
    const navRect = nav?.getBoundingClientRect();
    return {
      canvasHeight: Number.parseFloat(
        document.documentElement.style.getPropertyValue(
          "--ak-standalone-canvas-height",
        ),
      ),
      shellBottom: shellRect?.bottom ?? null,
      shellHeight: shellRect?.height ?? null,
      navTop: navRect?.top ?? null,
      navBottom: navRect?.bottom ?? null,
      navHeight: navRect?.height ?? null,
      navPaddingBottom: nav
        ? Number.parseFloat(getComputedStyle(nav).paddingBottom)
        : null,
    };
  });
  expect(geometry).toEqual({
    canvasHeight: 852,
    shellBottom: 852,
    shellHeight: 852,
    navTop: 767,
    navBottom: 852,
    navHeight: 85,
    navPaddingBottom: 34,
  });

  const stableFrame = await page.screenshot();
  await testInfo.attach("captured-852-stable", {
    body: stableFrame,
    contentType: "image/png",
  });
});

const iphonePortraits = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 430, height: 932 },
];

for (const viewport of iphonePortraits) {
  test(`first paint keeps bottom navigation visually settled at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await authorize(page.context());
    await mockToday(page);
    await page.goto("/");
    await expect(
      page.getByRole("navigation", { name: "主导航" }),
    ).toBeVisible();
    await expect(
      page.locator("[data-today-content-visible='true']"),
    ).toBeVisible();

    await page.evaluate(() => {
      document
        .querySelector<HTMLElement>("main")
        ?.style.setProperty("min-height", "1600px", "important");
    });
    await simulateIosFirstPaintFixedAnchor(page);

    const bottomNavHeight = await page
      .locator(".bottom-nav")
      .evaluate((nav) => nav.getBoundingClientRect().height);

    const firstPaint = await page.screenshot();
    const firstPaintBottom = await page.screenshot({
      clip: {
        x: 0,
        y: viewport.height - bottomNavHeight,
        width: viewport.width,
        height: bottomNavHeight,
      },
    });
    await testInfo.attach("first-paint", {
      body: firstPaint,
      contentType: "image/png",
    });

    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(
        "[data-app-shell-content]",
      );
      if (root) root.scrollTop = 48;
      else window.scrollTo({ top: 48 });
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.querySelector<HTMLElement>(".bottom-nav")?.dataset
              .iosFixedAnchorFault ?? null,
        ),
      )
      .toBeNull();

    const settledAfterScroll = await page.screenshot();
    const settledAfterScrollBottom = await page.screenshot({
      clip: {
        x: 0,
        y: viewport.height - bottomNavHeight,
        width: viewport.width,
        height: bottomNavHeight,
      },
    });
    await testInfo.attach("settled-after-scroll", {
      body: settledAfterScroll,
      contentType: "image/png",
    });

    expect(firstPaintBottom.equals(settledAfterScrollBottom)).toBe(true);
    const telemetry = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>(".bottom-nav");
      const probe = document.createElement("div");
      probe.style.cssText =
        "position: fixed; right: 0; bottom: 0; width: 1px; height: env(safe-area-inset-bottom); pointer-events: none;";
      document.body.append(probe);
      const navRect = nav?.getBoundingClientRect();
      const visualViewport = window.visualViewport;
      const snapshot = {
        windowInnerHeight: window.innerHeight,
        documentClientHeight: document.documentElement.clientHeight,
        visualViewportHeight: visualViewport?.height ?? null,
        visualViewportOffsetTop: visualViewport?.offsetTop ?? null,
        visualViewportPageTop: visualViewport?.pageTop ?? null,
        navBottom: navRect?.bottom ?? null,
        navPosition: nav ? getComputedStyle(nav).position : null,
        navPaddingBottom: nav ? getComputedStyle(nav).paddingBottom : null,
        safeAreaProbeHeight: probe.getBoundingClientRect().height,
        standalone: matchMedia("(display-mode: standalone)").matches,
      };
      probe.remove();
      return snapshot;
    });
    expect(telemetry.navPosition).not.toBe("fixed");
    expect(telemetry.navBottom).toBe(telemetry.windowInnerHeight);
  });
}

test("dynamic shell keeps the navigation in place through viewport changes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await authorize(page.context());
  await mockToday(page);
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();

  const inspect = async (name: string) => {
    const screenshot = await page.screenshot();
    await testInfo.attach(name, { body: screenshot, contentType: "image/png" });
    const layout = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(
        "[data-app-shell-content]",
      );
      const nav = document.querySelector<HTMLElement>(".bottom-nav");
      const rect = nav?.getBoundingClientRect();
      return {
        contentIsScroller: root
          ? root.scrollHeight >= root.clientHeight
          : false,
        navBottom: rect?.bottom ?? null,
        navPosition: nav ? getComputedStyle(nav).position : null,
        viewportHeight: window.innerHeight,
      };
    });
    expect(layout.contentIsScroller).toBe(true);
    expect(layout.navPosition).not.toBe("fixed");
    expect(layout.navBottom).toBe(layout.viewportHeight);
  };

  await inspect("portrait-first-paint");
  await page.setViewportSize({ width: 393, height: 520 });
  await inspect("keyboard-height");
  await page.setViewportSize({ width: 852, height: 393 });
  await inspect("landscape");
  await page.setViewportSize({ width: 393, height: 852 });
  await inspect("portrait-restored");
});
