import {
  calendarAggregateSchema,
  dayAggregateSchema,
  todayAggregateSchema,
} from "@/domain/api-contracts";

async function getJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`request_failed_${response.status}`);
  return response.json();
}

export async function fetchTodayAggregate(
  trackerKey: string,
  localDate: string,
  signal?: AbortSignal,
) {
  return todayAggregateSchema.parse(
    await getJson(
      `/api/trackers/${encodeURIComponent(trackerKey)}/today?date=${encodeURIComponent(localDate)}`,
      signal,
    ),
  );
}

export async function fetchCalendarAggregate(
  trackerKey: string,
  month: string,
  signal?: AbortSignal,
) {
  return calendarAggregateSchema.parse(
    await getJson(
      `/api/trackers/${encodeURIComponent(trackerKey)}/calendar?month=${encodeURIComponent(month)}`,
      signal,
    ),
  );
}

export async function fetchDayAggregate(
  trackerKey: string,
  localDate: string,
  signal?: AbortSignal,
) {
  return dayAggregateSchema.parse(
    await getJson(
      `/api/trackers/${encodeURIComponent(trackerKey)}/days/${encodeURIComponent(localDate)}`,
      signal,
    ),
  );
}
