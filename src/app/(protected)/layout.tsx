import { redirect } from "next/navigation";

import { AppProviders } from "@/components/app-providers";
import { ProtectedAppShell } from "@/components/protected-app-shell";
import { getAuthorizedSession } from "@/server/auth/session";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await getAuthorizedSession())) redirect("/login");

  return (
    <AppProviders>
      <ProtectedAppShell>{children}</ProtectedAppShell>
    </AppProviders>
  );
}
