// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PwaUpdatePrompt,
  ServiceWorkerRegistration as ServiceWorkerRegistrationProvider,
} from "@/components/service-worker-registration";
import type { PendingCommand } from "@/offline/command-contracts";
import {
  createOfflineDatabase,
  type TrackerOfflineDatabase,
} from "@/offline/store";

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const databases: TrackerOfflineDatabase[] = [];

function testDatabase() {
  const database = createOfflineDatabase(
    `ak-tracker-pwa-update-${crypto.randomUUID()}`,
  );
  databases.push(database);
  return database;
}

const anonymousPendingCommand: PendingCommand = {
  id: "019c0000-0000-4000-8000-000000000701",
  schemaVersion: 1,
  githubUserId: "10001",
  trackerKey: "knee-rehab",
  kind: "task_update",
  createdAt: "2026-07-20T10:00:00.000Z",
  occurredAt: "2026-07-20T10:00:00.000Z",
  localDate: "2026-07-20",
  occurredTimeZone: "Asia/Shanghai",
  occurredUtcOffsetMinutes: 480,
  attemptCount: 0,
  nextAttemptAt: "2026-07-20T10:00:00.000Z",
  lastAttemptAt: null,
  lastErrorCode: null,
  status: "local_only",
  sourceVersion: null,
  payload: {
    taskId: "019c0000-0000-4000-8000-000000000702",
    status: "completed",
    actual: null,
    note: null,
    baseStatus: "planned",
    planVersion: 1,
  },
};

type Dispatchable = {
  dispatch: (type: string) => void;
};

function eventTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, listener: () => void) {
      const current = listeners.get(type) ?? new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

function installServiceWorkerHarness(options?: {
  online?: boolean;
  waiting?: boolean;
  installing?: boolean;
}) {
  const containerTarget = eventTarget();
  const registrationTarget = eventTarget();
  const workerTarget = eventTarget();
  const postMessage = vi.fn();
  const update = vi.fn(async () => undefined);
  const worker = {
    ...workerTarget,
    state: "installed",
    postMessage,
  } as unknown as ServiceWorker & Dispatchable;
  const registration = {
    ...registrationTarget,
    waiting: options?.waiting === false ? null : worker,
    installing: options?.installing ? worker : null,
    update,
  } as unknown as globalThis.ServiceWorkerRegistration & Dispatchable;
  const container = {
    ...containerTarget,
    controller: {} as ServiceWorker,
    register: vi.fn(async () => registration),
  } as unknown as ServiceWorkerContainer & Dispatchable;
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: container,
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: options?.online ?? true,
  });
  return { container, registration, worker, postMessage, update };
}

function UpdateView({ pending = 0 }: { pending?: number }) {
  return <PwaUpdatePrompt pendingCommandCount={pending} />;
}

describe("controlled PWA updates", () => {
  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await Promise.all(
      databases.splice(0).map(async (database) => {
        database.close();
        await database.delete();
      }),
    );
  });

  it("detects a waiting worker and lets the user postpone without reloading", async () => {
    const { container } = installServiceWorkerHarness();
    const reload = vi.fn();
    render(
      <ServiceWorkerRegistrationProvider enabled reloadPage={reload}>
        <UpdateView />
      </ServiceWorkerRegistrationProvider>,
    );

    expect(await screen.findByText("新版本可用")).toBeTruthy();
    container.dispatch("controllerchange");
    fireEvent.click(screen.getByRole("button", { name: "稍后" }));
    expect(screen.queryByText("新版本可用")).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("activates once without clearing a pending local command", async () => {
    const database = testDatabase();
    await database.pendingCommands.put(anonymousPendingCommand);
    const { container, postMessage } = installServiceWorkerHarness();
    const reload = vi.fn();
    render(
      <ServiceWorkerRegistrationProvider enabled reloadPage={reload}>
        <UpdateView pending={1} />
      </ServiceWorkerRegistrationProvider>,
    );

    expect(
      await screen.findByText("更新不会删除 1 条仅保存在本机的记录。"),
    ).toBeTruthy();
    const update = screen.getByRole("button", { name: "立即更新" });
    fireEvent.click(update);
    fireEvent.click(update);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });

    container.dispatch("controllerchange");
    container.dispatch("controllerchange");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(
      await database.pendingCommands.get(anonymousPendingCommand.id),
    ).toEqual(anonymousPendingCommand);
  });

  it("does not check for updates or claim availability while offline", async () => {
    const { container, update } = installServiceWorkerHarness({
      online: false,
    });
    render(
      <ServiceWorkerRegistrationProvider enabled reloadPage={vi.fn()}>
        <UpdateView />
      </ServiceWorkerRegistrationProvider>,
    );

    await waitFor(() => expect(container.register).toHaveBeenCalledOnce());
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByText("新版本可用")).toBeNull();

    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(await screen.findByText("新版本可用")).toBeTruthy();
  });

  it("throttles repeated visible checks and allows a later bounded check", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { update } = installServiceWorkerHarness({ waiting: false });
    render(
      <ServiceWorkerRegistrationProvider enabled reloadPage={vi.fn()}>
        <UpdateView />
      </ServiceWorkerRegistrationProvider>,
    );

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(update).toHaveBeenCalledOnce();

    now += 5 * 60 * 1000;
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  });

  it("notices a worker installed through updatefound", async () => {
    const { registration, worker } = installServiceWorkerHarness({
      waiting: false,
    });
    render(
      <ServiceWorkerRegistrationProvider enabled reloadPage={vi.fn()}>
        <UpdateView />
      </ServiceWorkerRegistrationProvider>,
    );
    await waitFor(() => expect(registration.update).toHaveBeenCalled());

    Object.defineProperty(registration, "installing", {
      configurable: true,
      value: worker,
    });
    Object.defineProperty(registration, "waiting", {
      configurable: true,
      value: worker,
    });
    registration.dispatch("updatefound");
    worker.dispatch("statechange");

    expect(await screen.findByText("新版本可用")).toBeTruthy();
  });

  it("observes an installation that already started before register resolved", async () => {
    const { registration, worker } = installServiceWorkerHarness({
      waiting: false,
      installing: true,
    });
    Object.defineProperty(worker, "state", {
      configurable: true,
      value: "installing",
      writable: true,
    });
    render(
      <ServiceWorkerRegistrationProvider enabled reloadPage={vi.fn()}>
        <UpdateView />
      </ServiceWorkerRegistrationProvider>,
    );
    await waitFor(() => expect(registration.update).toHaveBeenCalledOnce());

    Object.defineProperty(registration, "waiting", {
      configurable: true,
      value: worker,
    });
    Object.defineProperty(worker, "state", {
      configurable: true,
      value: "installed",
    });
    worker.dispatch("statechange");

    expect(await screen.findByText("新版本可用")).toBeTruthy();
  });

  it("does nothing when the waiting worker disappeared before confirmation", async () => {
    const { registration, postMessage, container } =
      installServiceWorkerHarness();
    const reload = vi.fn();
    render(
      <ServiceWorkerRegistrationProvider enabled reloadPage={reload}>
        <UpdateView />
      </ServiceWorkerRegistrationProvider>,
    );
    expect(await screen.findByText("新版本可用")).toBeTruthy();
    Object.defineProperty(registration, "waiting", {
      configurable: true,
      value: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    container.dispatch("controllerchange");
    expect(postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
