import { DashboardShell } from "@/components/dashboard-shell";

export default function Home() {
  const today = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());

  return <DashboardShell today={today.replace("周", " · 周")} />;
}
