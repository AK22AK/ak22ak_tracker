"use client";

import { createContext, useContext, useEffect } from "react";

import { prepareOfflineIdentity } from "./query-snapshots";
import { offlineDatabase } from "./store";

const PrivateOfflineIdentityContext = createContext<string | null>(null);

export function PrivateOfflineIdentityProvider({
  githubUserId,
  children,
}: {
  githubUserId: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    void prepareOfflineIdentity(offlineDatabase, githubUserId);
  }, [githubUserId]);

  return (
    <PrivateOfflineIdentityContext.Provider value={githubUserId}>
      {children}
    </PrivateOfflineIdentityContext.Provider>
  );
}

export function usePrivateOfflineIdentity() {
  return useContext(PrivateOfflineIdentityContext);
}
