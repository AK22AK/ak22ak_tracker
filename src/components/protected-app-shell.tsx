"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { BottomNav } from "./bottom-nav";
import { TabTransitionFrame } from "./tab-page-frame";

export function ProtectedAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const effectivePendingPath = pendingPath === pathname ? null : pendingPath;

  const navigate = useCallback(
    (href: string) => {
      if (href === pathname) {
        setPendingPath(null);
        return;
      }
      setPendingPath(href);
      router.push(href, { scroll: false });
    },
    [pathname, router],
  );

  return (
    <div className="protected-app-shell">
      {effectivePendingPath ? (
        <TabTransitionFrame pathname={effectivePendingPath} />
      ) : (
        children
      )}
      <BottomNav
        activePath={effectivePendingPath ?? pathname}
        onNavigate={navigate}
      />
    </div>
  );
}
