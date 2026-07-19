"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { registerPrivateQueryStateCleaner } from "@/offline/clear-private-client-state";
import { PrivateOfflineIdentityProvider } from "@/offline/private-offline-context";

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

  useEffect(() => {
    const unregister = registerPrivateQueryStateCleaner(() =>
      queryClient.clear(),
    );
    return () => {
      unregister();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <PrivateOfflineIdentityProvider githubUserId={githubUserId}>
        {children}
      </PrivateOfflineIdentityProvider>
    </QueryClientProvider>
  );
}
