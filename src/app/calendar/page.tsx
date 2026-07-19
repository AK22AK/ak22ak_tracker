import { redirect } from "next/navigation";

import { CalendarShell } from "@/components/calendar-shell";
import { isLocalDate } from "@/domain/calendar";
import { localDateInTimeZone } from "@/domain/planning-time";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  getCalendarMonth,
  getTodayDashboard,
  getTrackerPlanningTimeZone,
} from "@/server/dashboard";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const session = await getAuthorizedSession();
  if (!session) redirect("/login");

  const planningTimeZone =
    (await getTrackerPlanningTimeZone("knee-rehab")) ?? "Asia/Shanghai";
  const today = localDateInTimeZone(new Date(), planningTimeZone);
  const requestedDate = (await searchParams).date;
  const selectedDate =
    isLocalDate(requestedDate) && !Array.isArray(requestedDate)
      ? requestedDate
      : today;
  const month = selectedDate.slice(0, 7);
  const [dashboard, days] = await Promise.all([
    getTodayDashboard("knee-rehab", selectedDate),
    getCalendarMonth("knee-rehab", month),
  ]);

  return (
    <CalendarShell
      month={month}
      today={today}
      selectedDate={selectedDate}
      days={days}
      dashboard={dashboard}
    />
  );
}
