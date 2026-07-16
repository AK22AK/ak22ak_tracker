import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { authOptions } from "@/server/auth/options";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  const today = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());

  return <DashboardShell today={today.replace("周", " · 周")} />;
}
