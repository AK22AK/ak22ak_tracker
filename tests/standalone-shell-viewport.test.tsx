// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STANDALONE_SHELL_VIEWPORT_SCRIPT,
  StandaloneShellViewportBootstrap,
} from "@/components/standalone-shell-viewport-bootstrap";
import sequence from "./fixtures/ios-standalone-shell-viewport-sequence.json";

type Sample = (typeof sequence.samples)[number];

function installReplayHarness() {
  let sample: Sample = sequence.samples[0];
  let nextFrame = 1;
  const frames: FrameRequestCallback[] = [];

  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(display-mode: standalone)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(navigator, "standalone", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "iPhone",
  });
  Object.defineProperty(window, "screen", {
    configurable: true,
    value: {
      width: sequence.environment.screenWidth,
      height: sequence.environment.screenHeight,
      availWidth: sequence.environment.screenWidth,
      availHeight: sequence.environment.screenHeight,
    },
  });
  Object.defineProperty(window, "outerHeight", {
    configurable: true,
    value: sequence.environment.outerHeight,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: sequence.environment.innerHeight,
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return nextFrame++;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  const originalRect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const probe = (this as HTMLElement).dataset.akShellGeometryProbe;
      if (probe === "vh") {
        return {
          x: 0,
          y: 0,
          top: 0,
          right: 1,
          bottom: sample.vh,
          left: 0,
          width: 1,
          height: sample.vh,
          toJSON: () => ({}),
        };
      }
      if (probe === "safe-bottom") {
        return {
          x: 0,
          y: 0,
          top: 0,
          right: 1,
          bottom: sample.safeBottom,
          left: 0,
          width: 1,
          height: sample.safeBottom,
          toJSON: () => ({}),
        };
      }
      return originalRect.call(this);
    },
  );

  const advance = (next: Sample) => {
    sample = next;
    const callbacks = frames.splice(0);
    callbacks.forEach((callback) => callback(next.at));
  };

  return { advance };
}

describe("iOS standalone shell viewport bootstrap", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-ak-ios-standalone-canvas");
    document.documentElement.removeAttribute("data-ak-shell-geometry-ready");
    document.documentElement.style.removeProperty(
      "--ak-standalone-canvas-height",
    );
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("replays the captured 793 to 852 startup and reveals content only after stable geometry", () => {
    const { advance } = installReplayHarness();

    window.eval(STANDALONE_SHELL_VIEWPORT_SCRIPT);

    expect(document.documentElement.dataset.akIosStandaloneCanvas).toBe("true");
    expect(document.documentElement.dataset.akShellGeometryReady).toBe("false");
    expect(
      document.documentElement.style.getPropertyValue(
        "--ak-standalone-canvas-height",
      ),
    ).toBe("852px");

    for (const sample of sequence.samples.slice(1, -1)) {
      advance(sample);
      expect(document.documentElement.dataset.akShellGeometryReady).toBe(
        "false",
      );
    }

    advance(sequence.samples.at(-1)!);
    expect(document.documentElement.dataset.akShellGeometryReady).toBe("true");
  });

  it("keeps ordinary browser mode on its dynamic viewport path", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      value: false,
    });

    window.eval(STANDALONE_SHELL_VIEWPORT_SCRIPT);

    expect(
      document.documentElement.dataset.akIosStandaloneCanvas,
    ).toBeUndefined();
    expect(
      document.documentElement.dataset.akShellGeometryReady,
    ).toBeUndefined();
  });

  it("installs before protected content is parsed", () => {
    render(<StandaloneShellViewportBootstrap />);

    const script = document.querySelector(
      "#ak-standalone-shell-viewport",
    ) as HTMLScriptElement | null;
    expect(script?.textContent).toContain("data-ak-shell-geometry-ready");
    expect(script?.textContent).toContain("--ak-standalone-canvas-height");
  });
});
