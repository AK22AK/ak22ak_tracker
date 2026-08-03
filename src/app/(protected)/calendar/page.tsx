import { CalendarClient } from "@/components/calendar-client";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const requestedDate = (await searchParams).date;
  return (
    <div className="root-tab-route-content" data-root-tab-content="calendar">
      <CalendarClient
        initialDate={
          typeof requestedDate === "string" ? requestedDate : undefined
        }
      />
    </div>
  );
}
