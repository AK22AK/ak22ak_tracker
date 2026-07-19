import { describe, expect, it, vi } from "vitest";

import { clearPrivateClientState } from "@/offline/private-state";

describe("private client state cleanup (P0-08)", () => {
  it("clears query state, IndexedDB, tracker caches and user storage", async () => {
    const clearQueryState = vi.fn();
    const clearIndexedDb = vi.fn();
    const deleteCache = vi.fn(async () => true);
    const removeLocal = vi.fn();
    const removeSession = vi.fn();

    await clearPrivateClientState({
      clearQueryState,
      clearIndexedDb,
      cacheStorage: {
        keys: async () => ["ak-tracker-shell-v3", "other-app"],
        delete: deleteCache,
      },
      localStorage: {
        keys: () => ["ak-tracker:user", "other-app"],
        remove: removeLocal,
      },
      sessionStorage: {
        keys: () => ["ak-tracker:draft"],
        remove: removeSession,
      },
    });

    expect(clearQueryState).toHaveBeenCalledOnce();
    expect(clearIndexedDb).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("ak-tracker-shell-v3");
    expect(deleteCache).not.toHaveBeenCalledWith("other-app");
    expect(removeLocal).toHaveBeenCalledWith("ak-tracker:user");
    expect(removeSession).toHaveBeenCalledWith("ak-tracker:draft");
  });
});
