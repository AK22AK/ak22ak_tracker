"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { todayContentVisibleEvent } from "@/client/startup-performance";
import { registerPrivateQueryStateCleaner } from "@/offline/clear-private-client-state";
import { PrivateOfflineIdentityProvider } from "@/offline/private-offline-context";
import { OfflineCommandProvider } from "@/offline/offline-command-context";

import { GitHubMirrorRecovery } from "./github-mirror-recovery";
import { GarminRecovery } from "./garmin-recovery";

export function AppProviders({
  githubUserId,
  children,
}: {
  githubUserId: string;
  children: React.ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  const [recoveryReady, setRecoveryReady] = useState(false);

  useEffect(() => {
    const unregister = registerPrivateQueryStateCleaner(() =>
      queryClient.clear(),
    );
    return () => {
      unregister();
    };
  }, [queryClient]);

  useEffect(() => {
    if (recoveryReady) return;
    const release = () => setRecoveryReady(true);
    window.addEventListener(todayContentVisibleEvent, release, { once: true });

    const idleWindow = window as typeof window & {
      requestIdleCallback?: (
        callback: () => void,
        options: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | undefined;
    const timeoutId = setTimeout(() => {
      if (idleWindow.requestIdleCallback) {
        idleId = idleWindow.requestIdleCallback(release, { timeout: 1_000 });
      } else {
        release();
      }
    }, 3_000);
    return () => {
      window.removeEventListener(todayContentVisibleEvent, release);
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
      clearTimeout(timeoutId);
    };
  }, [recoveryReady]);

  return (
    <QueryClientProvider client={queryClient}>
      {recoveryReady ? (
        <>
          <GitHubMirrorRecovery />
          <GarminRecovery trackerKey="knee-rehab" />
        </>
      ) : null}
      <PrivateOfflineIdentityProvider githubUserId={githubUserId}>
        <OfflineCommandProvider githubUserId={githubUserId}>
          {children}
        </OfflineCommandProvider>
      </PrivateOfflineIdentityProvider>
    </QueryClientProvider>
  );
}
