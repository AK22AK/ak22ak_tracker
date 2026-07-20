"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function reloadCurrentPage() {
  window.location.reload();
}

type ServiceWorkerUpdateContextValue = {
  updateAvailable: boolean;
  activating: boolean;
  activateUpdate: () => boolean;
  dismissUpdate: () => void;
};

const detachedUpdateContext: ServiceWorkerUpdateContextValue = {
  updateAvailable: false,
  activating: false,
  activateUpdate: () => false,
  dismissUpdate: () => undefined,
};

const ServiceWorkerUpdateContext =
  createContext<ServiceWorkerUpdateContextValue>(detachedUpdateContext);

export function ServiceWorkerRegistration({
  children,
  enabled = process.env.NODE_ENV === "production",
  reloadPage = reloadCurrentPage,
}: {
  children: React.ReactNode;
  enabled?: boolean;
  reloadPage?: () => void;
}) {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(
    null,
  );
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [activating, setActivating] = useState(false);
  const registrationRef = useRef<globalThis.ServiceWorkerRegistration | null>(
    null,
  );
  const visibleWorkerRef = useRef<ServiceWorker | null>(null);
  const dismissedWorkerRef = useRef<ServiceWorker | null>(null);
  const activatingRef = useRef(false);
  const reloadRequestedRef = useRef(false);
  const reloadedRef = useRef(false);
  const lastUpdateCheckAtRef = useRef(0);

  const publishWaitingWorker = useCallback((worker: ServiceWorker | null) => {
    visibleWorkerRef.current = worker;
    if (!worker || dismissedWorkerRef.current !== worker) {
      setWaitingWorker(worker);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator)) return;
    let disposed = false;
    const workerCleanups = new Set<() => void>();
    const observedInstallingWorkers = new WeakSet<ServiceWorker>();

    const inspectWaitingWorker = (
      registration: globalThis.ServiceWorkerRegistration,
    ) => {
      if (disposed || !navigator.serviceWorker.controller) return;
      publishWaitingWorker(registration.waiting);
    };

    const checkForUpdate = (force = false) => {
      const registration = registrationRef.current;
      if (!registration || !navigator.onLine) return;
      const now = Date.now();
      if (
        !force &&
        now - lastUpdateCheckAtRef.current < UPDATE_CHECK_INTERVAL_MS
      ) {
        return;
      }
      lastUpdateCheckAtRef.current = now;
      void registration
        .update()
        .then(() => inspectWaitingWorker(registration))
        .catch(() => undefined);
    };

    const onControllerChange = () => {
      if (!reloadRequestedRef.current || reloadedRef.current) return;
      reloadedRef.current = true;
      reloadPage();
    };
    const onOnline = () => {
      setOnline(true);
      checkForUpdate(true);
    };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);

    void navigator.serviceWorker
      .register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      })
      .then((registration) => {
        if (disposed) return;
        registrationRef.current = registration;
        inspectWaitingWorker(registration);

        const onUpdateFound = () => {
          const installing = registration.installing;
          if (!installing || observedInstallingWorkers.has(installing)) return;
          observedInstallingWorkers.add(installing);
          const onStateChange = () => {
            if (installing.state === "installed") {
              inspectWaitingWorker(registration);
            }
          };
          installing.addEventListener("statechange", onStateChange);
          workerCleanups.add(() =>
            installing.removeEventListener("statechange", onStateChange),
          );
        };
        registration.addEventListener("updatefound", onUpdateFound);
        workerCleanups.add(() =>
          registration.removeEventListener("updatefound", onUpdateFound),
        );
        onUpdateFound();
        checkForUpdate(true);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      for (const cleanup of workerCleanups) cleanup();
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, publishWaitingWorker, reloadPage]);

  const dismissUpdate = useCallback(() => {
    dismissedWorkerRef.current = visibleWorkerRef.current;
    setWaitingWorker(null);
  }, []);

  const activateUpdate = useCallback(() => {
    if (activatingRef.current || !navigator.onLine) return false;
    const worker = registrationRef.current?.waiting ?? null;
    if (!worker || worker !== visibleWorkerRef.current) {
      publishWaitingWorker(null);
      return false;
    }
    activatingRef.current = true;
    reloadRequestedRef.current = true;
    setActivating(true);
    try {
      worker.postMessage({ type: "SKIP_WAITING" });
      return true;
    } catch {
      activatingRef.current = false;
      reloadRequestedRef.current = false;
      setActivating(false);
      publishWaitingWorker(null);
      return false;
    }
  }, [publishWaitingWorker]);

  const value = useMemo(
    () => ({
      updateAvailable: online && waitingWorker !== null,
      activating,
      activateUpdate,
      dismissUpdate,
    }),
    [activateUpdate, activating, dismissUpdate, online, waitingWorker],
  );

  return (
    <ServiceWorkerUpdateContext.Provider value={value}>
      {children}
    </ServiceWorkerUpdateContext.Provider>
  );
}

export function PwaUpdatePrompt({
  pendingCommandCount,
}: {
  pendingCommandCount: number;
}) {
  const update = useContext(ServiceWorkerUpdateContext);
  if (!update.updateAvailable) return null;

  return (
    <section className="pwa-update-banner" aria-labelledby="pwa-update-title">
      <div aria-live="polite">
        <strong id="pwa-update-title">新版本可用</strong>
        <p>
          {pendingCommandCount > 0
            ? `更新不会删除 ${pendingCommandCount} 条仅保存在本机的记录。`
            : "更新会重新载入应用，但不会清除本机离线数据。"}
        </p>
        <small>如正在编辑，请先完成当前内容或选择稍后。</small>
      </div>
      <div className="pwa-update-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={update.activating}
          onClick={update.dismissUpdate}
        >
          稍后
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={update.activating}
          onClick={update.activateUpdate}
        >
          {update.activating ? "正在更新…" : "立即更新"}
        </button>
      </div>
    </section>
  );
}
