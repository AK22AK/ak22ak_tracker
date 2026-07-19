const TRACKER_STORAGE_PREFIX = "ak-tracker:";
const TRACKER_CACHE_PREFIX = "ak-tracker-";

type CacheStorageLike = {
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
};

type KeyValueStorageLike = {
  keys(): string[];
  remove(key: string): void;
};

export type PrivateClientStateDependencies = {
  clearQueryState(): void | Promise<void>;
  clearIndexedDb(): void | Promise<void>;
  cacheStorage: CacheStorageLike;
  localStorage: KeyValueStorageLike;
  sessionStorage: KeyValueStorageLike;
};

async function clearStorage(storage: KeyValueStorageLike) {
  for (const key of storage.keys()) {
    if (key.startsWith(TRACKER_STORAGE_PREFIX)) {
      storage.remove(key);
    }
  }
}

export async function clearPrivateClientState(
  dependencies: PrivateClientStateDependencies,
) {
  const cacheNames = await dependencies.cacheStorage.keys();
  await Promise.all([
    dependencies.clearQueryState(),
    dependencies.clearIndexedDb(),
    ...cacheNames
      .filter((name) => name.startsWith(TRACKER_CACHE_PREFIX))
      .map((name) => dependencies.cacheStorage.delete(name)),
  ]);
  await Promise.all([
    clearStorage(dependencies.localStorage),
    clearStorage(dependencies.sessionStorage),
  ]);
}
