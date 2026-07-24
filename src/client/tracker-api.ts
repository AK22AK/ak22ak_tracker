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
import {
  createExecutionContextCommandSchema,
  endExecutionPauseCommandSchema,
  endExecutionContextCommandSchema,
  executionContextCommandResultSchema,
  setExecutionDayCommandSchema,
  startExecutionPauseCommandSchema,
  type CreateExecutionContextCommand,
  type EndExecutionContextCommand,
  type EndExecutionPauseCommand,
  type SetExecutionDayCommand,
  type StartExecutionPauseCommand,
} from "@/domain/execution-context";
import {
  resumptionAssessmentDtoSchema,
  resumptionDecisionCommandSchema,
  resumptionDecisionResultSchema,
  type ResumptionDecisionCommand,
} from "@/domain/resumption";
import { trendsAggregateSchema } from "@/domain/trends";

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

export async function fetchTrendsAggregate(
  trackerKey: string,
  signal?: AbortSignal,
) {
  return trendsAggregateSchema.parse(
    await getJson(
      `/api/trackers/${encodeURIComponent(trackerKey)}/trends`,
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

async function sendExecutionCommand(
  url: string,
  method: "POST" | "PUT",
  body: unknown,
) {
  const response = await fetch(url, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `request_failed_${response.status}`);
  }
  return executionContextCommandResultSchema.parse(await response.json());
}

export function createExecutionContext(
  trackerKey: string,
  input: CreateExecutionContextCommand,
) {
  return sendExecutionCommand(
    `/api/trackers/${encodeURIComponent(trackerKey)}/execution-contexts`,
    "POST",
    createExecutionContextCommandSchema.parse(input),
  );
}

export function endExecutionContext(
  trackerKey: string,
  input: EndExecutionContextCommand,
) {
  const command = endExecutionContextCommandSchema.parse(input);
  return sendExecutionCommand(
    `/api/trackers/${encodeURIComponent(trackerKey)}/execution-contexts/${encodeURIComponent(command.contextId)}/end`,
    "POST",
    command,
  );
}

export function setExecutionDay(
  trackerKey: string,
  input: SetExecutionDayCommand,
) {
  const command = setExecutionDayCommandSchema.parse(input);
  return sendExecutionCommand(
    `/api/trackers/${encodeURIComponent(trackerKey)}/execution-contexts/${encodeURIComponent(command.contextId)}/days/${encodeURIComponent(command.localDate)}`,
    "PUT",
    command,
  );
}

export function startExecutionPause(
  trackerKey: string,
  input: StartExecutionPauseCommand,
) {
  return sendExecutionCommand(
    `/api/trackers/${encodeURIComponent(trackerKey)}/pauses`,
    "POST",
    startExecutionPauseCommandSchema.parse(input),
  );
}

export function endExecutionPause(
  trackerKey: string,
  input: EndExecutionPauseCommand,
) {
  const command = endExecutionPauseCommandSchema.parse(input);
  return sendExecutionCommand(
    `/api/trackers/${encodeURIComponent(trackerKey)}/pauses/${encodeURIComponent(command.pauseId)}/end`,
    "POST",
    command,
  );
}

export async function fetchResumptionAssessment(
  trackerKey: string,
  assessmentId: string,
  signal?: AbortSignal,
) {
  return resumptionAssessmentDtoSchema.parse(
    await getJson(
      `/api/trackers/${encodeURIComponent(trackerKey)}/resumption-assessments/${encodeURIComponent(assessmentId)}`,
      signal,
    ),
  );
}

export async function decideResumption(
  trackerKey: string,
  input: ResumptionDecisionCommand,
) {
  const command = resumptionDecisionCommandSchema.parse(input);
  const response = await fetch(
    `/api/trackers/${encodeURIComponent(trackerKey)}/resumption-assessments/${encodeURIComponent(command.assessmentId)}/decision`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `request_failed_${response.status}`);
  }
  return resumptionDecisionResultSchema.parse(await response.json());
}
