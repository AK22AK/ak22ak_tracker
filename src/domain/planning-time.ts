import { isLocalDate } from "./calendar";

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

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

function dateTimeFormatter(timeZone: string) {
  const cached = dateTimeFormatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  dateTimeFormatterCache.set(timeZone, formatter);
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

export function instantAtLocalNoon(localDate: string, timeZone: string): Date {
  if (!isLocalDate(localDate) || !isIanaTimeZone(timeZone)) {
    throw new Error("Invalid local date or time zone");
  }
  const [year, month, day] = localDate.split("-").map(Number);
  const desiredUtcShape = Date.UTC(year, month - 1, day, 12, 0, 0);
  let candidate = desiredUtcShape;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = dateTimeFormatter(timeZone).formatToParts(candidate);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? NaN);
    const observedUtcShape = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
    );
    candidate += desiredUtcShape - observedUtcShape;
  }

  const result = new Date(candidate);
  if (localDateInTimeZone(result, timeZone) !== localDate) {
    throw new Error("Could not resolve local date");
  }
  return result;
}
