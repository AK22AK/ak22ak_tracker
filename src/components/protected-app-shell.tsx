"use client";

import { BottomNav } from "./bottom-nav";

export function ProtectedAppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="protected-app-shell">
      {children}
      <BottomNav />
    </div>
  );
}
