import type {
  ExternalRecord,
  PlanVersion,
  TrackerEvent,
} from "@/domain/schemas";

export function assertSafeMirrorSegment(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(value)) {
    throw new Error("unsafe_mirror_segment");
  }
  return value;
}

export function assertMirrorTargetPath(value: string): string {
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("%") ||
    value.includes("//")
  ) {
    throw new Error("unsafe_target_path");
  }
  const segments = value.split("/");
  const file = segments.at(-1);
  if (
    segments.length < 4 ||
    segments[0] !== "trackers" ||
    !file ||
    !/^[a-z0-9][a-z0-9_-]*(?:-[a-z0-9][a-z0-9_-]*)*\.json$/.test(file) ||
    segments.slice(1, -1).some((segment) => {
      try {
        assertSafeMirrorSegment(segment);
        return false;
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("unsafe_target_path");
  }
  return value;
}

function dateParts(localDate: string): { year: string; month: string } {
  const [year, month] = localDate.split("-");
  if (!year || !month) throw new Error("Invalid local date");
  return { year, month };
}

export function eventMirrorPath(event: TrackerEvent): string {
  const tracker = assertSafeMirrorSegment(event.trackerKey);
  const { year, month } = dateParts(event.localDate);
  return `trackers/${tracker}/events/${year}/${month}/${event.id}.json`;
}

export function externalRecordMirrorPath(record: ExternalRecord): string {
  const tracker = assertSafeMirrorSegment(record.trackerKey);
  const provider = assertSafeMirrorSegment(record.provider);
  const { year, month } = dateParts(record.localDate);
  return `trackers/${tracker}/external/${provider}/${year}/${month}/${record.id}.json`;
}

export function planVersionMirrorPath(plan: PlanVersion): string {
  const tracker = assertSafeMirrorSegment(plan.trackerKey);
  return `trackers/${tracker}/plan-versions/${String(plan.version).padStart(4, "0")}-${plan.id}.json`;
}
