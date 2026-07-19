import {
  calendarAggregateSchema,
  dayAggregateSchema,
  todayAggregateSchema,
} from "@/domain/api-contracts";
import {
  externalRecordAssociationCommandSchema,
  externalRecordAssociationResultSchema,
  type ExternalRecordAssociationCommand,
} from "@/domain/external-training";

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

export async function saveExternalRecordAssociation(
  trackerKey: string,
  input: ExternalRecordAssociationCommand,
) {
  const command = externalRecordAssociationCommandSchema.parse(input);
  const response = await fetch(
    `/api/trackers/${encodeURIComponent(trackerKey)}/external-records/${encodeURIComponent(command.externalRecordId)}/association`,
    {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    },
  );
  if (!response.ok) throw new Error(`request_failed_${response.status}`);
  return externalRecordAssociationResultSchema.parse(await response.json());
}
