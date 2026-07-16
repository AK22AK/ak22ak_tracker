import type {
  ExternalRecord,
  PlanVersion,
  TrackerEvent,
} from "@/domain/schemas";

function assertSafeSegment(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(value)) {
    throw new Error(`Unsafe path segment: ${value}`);
  }
  return value;
}

function dateParts(localDate: string): { year: string; month: string } {
  const [year, month] = localDate.split("-");
  if (!year || !month) throw new Error("Invalid local date");
  return { year, month };
}

export function eventMirrorPath(event: TrackerEvent): string {
  const tracker = assertSafeSegment(event.trackerKey);
  const { year, month } = dateParts(event.localDate);
  return `trackers/${tracker}/events/${year}/${month}/${event.id}.json`;
}

export function externalRecordMirrorPath(record: ExternalRecord): string {
  const tracker = assertSafeSegment(record.trackerKey);
  const provider = assertSafeSegment(record.provider);
  const { year, month } = dateParts(record.localDate);
  return `trackers/${tracker}/external/${provider}/${year}/${month}/${record.id}.json`;
}

export function planVersionMirrorPath(plan: PlanVersion): string {
  const tracker = assertSafeSegment(plan.trackerKey);
  return `trackers/${tracker}/plan-versions/${String(plan.version).padStart(4, "0")}-${plan.id}.json`;
}
