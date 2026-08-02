import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppProviders } from "@/components/app-providers";
import { ProtectedAppShell } from "@/components/protected-app-shell";
import { ProtectedStartupShell } from "@/components/protected-startup-shell";
import { getAuthorizedSession } from "@/server/auth/session";

async function AuthorizedProtectedLayout({
  children,
  feedback,
}: Readonly<{ children: React.ReactNode; feedback: React.ReactNode }>) {
  const session = await getAuthorizedSession();
  if (!session?.user?.githubId) redirect("/login");

  return (
    <AppProviders
      key={session.user.githubId}
      githubUserId={session.user.githubId}
    >
      <ProtectedAppShell>{children}</ProtectedAppShell>
      {feedback}
    </AppProviders>
  );
}

export default function ProtectedLayout(
  props: Readonly<{
    children: React.ReactNode;
    feedback: React.ReactNode;
  }>,
) {
  return (
    <Suspense fallback={<ProtectedStartupShell />}>
      <AuthorizedProtectedLayout {...props} />
    </Suspense>
  );
}
