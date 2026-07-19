import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

type Listener = (event: Record<string, unknown>) => void;

async function loadServiceWorker() {
  const listeners = new Map<string, Listener>();
  const addedUrls: string[][] = [];
  const deletedCaches: string[] = [];
  const source = await readFile(
    new URL("../public/sw.js", import.meta.url),
    "utf8",
  );
  const cache = {
    addAll: vi.fn(async (urls: string[]) => {
      addedUrls.push(urls);
    }),
    match: vi.fn(),
    put: vi.fn(),
  };
  const context = {
    URL,
    Promise,
    fetch: vi.fn(),
    caches: {
      open: vi.fn(async () => cache),
      keys: vi.fn(async () => ["ak-tracker-shell-v2", "unrelated-cache"]),
      delete: vi.fn(async (name: string) => {
        deletedCaches.push(name);
        return true;
      }),
      match: vi.fn(),
    },
    self: {
      location: { origin: "https://tracker.example" },
      clients: { claim: vi.fn() },
      skipWaiting: vi.fn(),
      addEventListener: (name: string, listener: Listener) => {
        listeners.set(name, listener);
      },
    },
  };

  runInNewContext(source, context);
  return { listeners, addedUrls, deletedCaches };
}

describe("Service Worker private-cache policy (P0-07/P0-08)", () => {
  it("pre-caches only public assets and removes the legacy authenticated shell", async () => {
    const { listeners, addedUrls, deletedCaches } = await loadServiceWorker();
    let install: Promise<unknown> | undefined;
    listeners.get("install")?.({
      waitUntil: (promise: Promise<unknown>) => {
        install = promise;
      },
    });
    await install;

    expect(addedUrls.flat()).not.toContain("/");

    let activate: Promise<unknown> | undefined;
    listeners.get("activate")?.({
      waitUntil: (promise: Promise<unknown>) => {
        activate = promise;
      },
    });
    await activate;
    expect(deletedCaches).toContain("ak-tracker-shell-v2");
  });

  it("never intercepts authenticated navigation or API requests", async () => {
    const { listeners } = await loadServiceWorker();
    const navigationRespond = vi.fn();
    listeners.get("fetch")?.({
      request: {
        method: "GET",
        url: "https://tracker.example/",
        mode: "navigate",
        destination: "document",
      },
      respondWith: navigationRespond,
    });
    expect(navigationRespond).not.toHaveBeenCalled();

    const apiRespond = vi.fn();
    listeners.get("fetch")?.({
      request: {
        method: "GET",
        url: "https://tracker.example/api/private",
        mode: "cors",
        destination: "",
      },
      respondWith: apiRespond,
    });
    expect(apiRespond).not.toHaveBeenCalled();
  });
});
