import { isLocalDate } from "./calendar";

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string) {
  const cached = dateFormatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  dateFormatterCache.set(timeZone, formatter);
  return formatter;
}

export function isIanaTimeZone(value: string): boolean {
  try {
    dateFormatter(value).format(new Date(0));
    return true;
  } catch {
    dateFormatterCache.delete(value);
    return false;
  }
}

export function localDateInTimeZone(
  instant: string | Date,
  timeZone: string,
): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.valueOf())) {
    throw new Error("Invalid instant");
  }

  const parts = dateFormatter(timeZone).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;
  if (!isLocalDate(localDate)) {
    throw new Error("Could not derive local date");
  }
  return localDate;
}

export function reportedUtcOffsetMinutes(getTimezoneOffset: number): number {
  if (!Number.isInteger(getTimezoneOffset)) {
    throw new Error("Invalid timezone offset");
  }
  return -getTimezoneOffset;
}
