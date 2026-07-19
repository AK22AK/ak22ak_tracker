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
  const networkFetch = vi.fn();
  const cacheMatch = vi.fn();
  const context = {
    URL,
    Promise,
    fetch: networkFetch,
    caches: {
      open: vi.fn(async () => cache),
      keys: vi.fn(async () => ["ak-tracker-shell-v2", "unrelated-cache"]),
      delete: vi.fn(async (name: string) => {
        deletedCaches.push(name);
        return true;
      }),
      match: cacheMatch,
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
  return {
    listeners,
    addedUrls,
    deletedCaches,
    networkFetch,
    cacheMatch,
  };
}

describe("Service Worker private-cache policy (P0-07/P0-08)", () => {
  it("pre-caches a self-contained public offline shell without the authenticated home page", async () => {
    const { listeners, addedUrls, deletedCaches } = await loadServiceWorker();
    let install: Promise<unknown> | undefined;
    listeners.get("install")?.({
      waitUntil: (promise: Promise<unknown>) => {
        install = promise;
      },
    });
    await install;

    expect(addedUrls.flat()).not.toContain("/");
    expect(addedUrls.flat()).toEqual(
      expect.arrayContaining(["/offline.html", "/offline.css", "/offline.js"]),
    );

    let activate: Promise<unknown> | undefined;
    listeners.get("activate")?.({
      waitUntil: (promise: Promise<unknown>) => {
        activate = promise;
      },
    });
    await activate;
    expect(deletedCaches).toContain("ak-tracker-shell-v2");
  });

  it("uses network-first navigation and falls back to the public shell without caching private HTML", async () => {
    const { listeners, networkFetch, cacheMatch } = await loadServiceWorker();
    const onlineResponse = new Response("private authenticated page");
    networkFetch.mockResolvedValueOnce(onlineResponse);
    const onlineRespond = vi.fn();
    listeners.get("fetch")?.({
      request: {
        method: "GET",
        url: "https://tracker.example/",
        mode: "navigate",
        destination: "document",
      },
      respondWith: onlineRespond,
    });
    expect(onlineRespond).toHaveBeenCalledOnce();
    await expect(onlineRespond.mock.calls[0]?.[0]).resolves.toBe(
      onlineResponse,
    );
    expect(cacheMatch).not.toHaveBeenCalled();

    const offlineShell = new Response("public offline shell");
    networkFetch.mockRejectedValueOnce(new TypeError("offline"));
    cacheMatch.mockResolvedValueOnce(offlineShell);
    const offlineRespond = vi.fn();
    listeners.get("fetch")?.({
      request: {
        method: "GET",
        url: "https://tracker.example/calendar",
        mode: "navigate",
        destination: "document",
      },
      respondWith: offlineRespond,
    });
    expect(offlineRespond).toHaveBeenCalledOnce();
    await expect(offlineRespond.mock.calls[0]?.[0]).resolves.toBe(offlineShell);
    expect(cacheMatch).toHaveBeenCalledWith("/offline.html");
  });

  it("never intercepts authenticated API requests", async () => {
    const { listeners } = await loadServiceWorker();

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
