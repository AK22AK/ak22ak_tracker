import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { CalendarShell } from "@/components/calendar-shell";
import { isLocalDate } from "@/domain/calendar";
import { authOptions } from "@/server/auth/options";
import { getCalendarMonth, getTodayDashboard } from "@/server/dashboard";

export const dynamic = "force-dynamic";

function shanghaiLocalDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const today = shanghaiLocalDate();
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
