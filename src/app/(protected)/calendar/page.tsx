import { CalendarClient } from "@/components/calendar-client";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const requestedDate = (await searchParams).date;
  return (
    <CalendarClient
      initialDate={
        typeof requestedDate === "string" ? requestedDate : undefined
      }
    />
  );
}
