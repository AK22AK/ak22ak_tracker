"use client";

import { createContext, useContext, type ReactNode } from "react";

export type RootTabLocation = {
  url: string;
  revision: number;
};

const RootTabLocationContext = createContext<RootTabLocation | null>(null);

export function RootTabLocationProvider({
  value,
  children,
}: {
  value: RootTabLocation | null;
  children: ReactNode;
}) {
  return (
    <RootTabLocationContext.Provider value={value}>
      {children}
    </RootTabLocationContext.Provider>
  );
}

export function useRootTabLocation() {
  return useContext(RootTabLocationContext);
}
