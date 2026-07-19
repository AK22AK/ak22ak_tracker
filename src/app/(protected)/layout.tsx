import { redirect } from "next/navigation";

import { AppProviders } from "@/components/app-providers";
import { ProtectedAppShell } from "@/components/protected-app-shell";
import { getAuthorizedSession } from "@/server/auth/session";

export default async function ProtectedLayout({
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
