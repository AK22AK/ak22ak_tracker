import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { localDateInTimeZone } from "@/domain/planning-time";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  getTodayDashboard,
  getTrackerPlanningTimeZone,
} from "@/server/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getAuthorizedSession();
  if (!session) {
    redirect("/login");
  }

  const now = new Date();
  const planningTimeZone =
    (await getTrackerPlanningTimeZone("knee-rehab")) ?? "Asia/Shanghai";
  const today = new Intl.DateTimeFormat("zh-CN", {
    timeZone: planningTimeZone,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(now);
  const localDate = localDateInTimeZone(now, planningTimeZone);
  const dashboard = await getTodayDashboard("knee-rehab", localDate);

  return (
    <DashboardShell
      today={today.replace("周", " · 周")}
      initialDashboard={dashboard}
    />
  );
}
