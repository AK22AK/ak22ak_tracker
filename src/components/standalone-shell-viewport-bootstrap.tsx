export const STANDALONE_SHELL_VIEWPORT_SCRIPT = String.raw`
(() => {
  const root = document.documentElement;
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(
    navigator.platform || navigator.userAgent,
  ) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!standalone || !ios) return;

  const canvasHeight = () =>
    Math.max(screen.height || 0, screen.availHeight || 0, outerHeight || 0);
  const applyCanvasHeight = () => {
    const height = canvasHeight();
    if (height > 0) {
      root.style.setProperty("--ak-standalone-canvas-height", height + "px");
    }
    return height;
  };

  root.setAttribute("data-ak-ios-standalone-canvas", "true");
  root.setAttribute("data-ak-shell-geometry-ready", "false");
  let expectedCanvasHeight = applyCanvasHeight();
  let frameId = 0;
  let lastSignature = "";
  let stableIntervals = 0;
  let vhProbe = null;
  let safeAreaProbe = null;

  const probe = (kind, height) => {
    const element = document.createElement("div");
    element.setAttribute("aria-hidden", "true");
    element.dataset.akShellGeometryProbe = kind;
    element.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;inset:auto;width:1px;height:" +
      height +
      ";";
    document.body.append(element);
    return element;
  };
  const ensureProbes = () => {
    if (!document.body) return false;
    vhProbe ||= probe("vh", "100vh");
    safeAreaProbe ||= probe("safe-bottom", "env(safe-area-inset-bottom)");
    return true;
  };
  const removeProbes = () => {
    vhProbe?.remove();
    safeAreaProbe?.remove();
    vhProbe = null;
    safeAreaProbe = null;
  };
  const publishReady = () => {
    cancelAnimationFrame(frameId);
    frameId = 0;
    removeProbes();
    root.setAttribute("data-ak-shell-geometry-ready", "true");
    dispatchEvent(new CustomEvent("ak-shell-geometry-ready"));
  };
  const sample = () => {
    if (!ensureProbes()) {
      frameId = requestAnimationFrame(sample);
      return;
    }
    expectedCanvasHeight = applyCanvasHeight();
    const vh = vhProbe.getBoundingClientRect().height;
    const safeBottom = safeAreaProbe.getBoundingClientRect().height;
    const signature =
      Math.round(vh * 100) + ":" +
      Math.round(safeBottom * 100) + ":" +
      Math.round(expectedCanvasHeight * 100);
    const coversCanvas =
      expectedCanvasHeight > 0 && Math.abs(vh - expectedCanvasHeight) <= 1;

    if (coversCanvas && signature === lastSignature) stableIntervals += 1;
    else stableIntervals = 0;
    lastSignature = signature;

    // Three unchanged animation-frame intervals ensure the late safe-area
    // update has joined the final 100vh value before protected content appears.
    if (coversCanvas && stableIntervals >= 3) {
      publishReady();
      return;
    }
    frameId = requestAnimationFrame(sample);
  };
  const rearmForCanvasChange = () => {
    const nextCanvasHeight = canvasHeight();
    if (
      nextCanvasHeight <= 0 ||
      Math.abs(nextCanvasHeight - expectedCanvasHeight) <= 1
    ) {
      return;
    }
    root.setAttribute("data-ak-shell-geometry-ready", "false");
    expectedCanvasHeight = applyCanvasHeight();
    lastSignature = "";
    stableIntervals = 0;
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(sample);
  };

  addEventListener("resize", rearmForCanvasChange);
  addEventListener("orientationchange", rearmForCanvasChange);
  screen.orientation?.addEventListener?.("change", rearmForCanvasChange);
  frameId = requestAnimationFrame(sample);
})();
`;

export function StandaloneShellViewportBootstrap() {
  return (
    <script
      id="ak-standalone-shell-viewport"
      dangerouslySetInnerHTML={{ __html: STANDALONE_SHELL_VIEWPORT_SCRIPT }}
    />
  );
}
