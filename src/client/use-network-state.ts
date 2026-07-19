"use client";

import { useSyncExternalStore } from "react";

function subscribeToNetworkState(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

export function useNetworkState() {
  return useSyncExternalStore(
    subscribeToNetworkState,
    () => navigator.onLine,
    () => true,
  );
}
