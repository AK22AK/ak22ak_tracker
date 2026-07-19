import "client-only";

import { clearOfflinePrivateData } from "./query-snapshots";
import { offlineDatabase } from "./store";
import { clearPrivateClientState } from "./private-state";

const queryStateCleaners = new Set<() => void | Promise<void>>();

export function registerPrivateQueryStateCleaner(
  cleaner: () => void | Promise<void>,
) {
  queryStateCleaners.add(cleaner);
  return () => queryStateCleaners.delete(cleaner);
}

function storageAdapter(storage: Storage) {
  return {
    keys: () =>
      Array.from({ length: storage.length }, (_, index) =>
        storage.key(index),
      ).filter((key): key is string => key !== null),
    remove: (key: string) => storage.removeItem(key),
  };
}

export async function clearCurrentUserClientState() {
  await clearPrivateClientState({
    clearQueryState: async () => {
      for (const cleaner of queryStateCleaners) await cleaner();
    },
    clearIndexedDb: () => clearOfflinePrivateData(offlineDatabase),
    cacheStorage: {
      keys: async () => [...(await caches.keys())],
      delete: (name) => caches.delete(name),
    },
    localStorage: storageAdapter(window.localStorage),
    sessionStorage: storageAdapter(window.sessionStorage),
  });
}
