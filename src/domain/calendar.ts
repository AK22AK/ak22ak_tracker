const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthPattern = /^\d{4}-\d{2}$/;

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !localDatePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

export function monthBounds(month: string) {
  if (!monthPattern.test(month)) throw new Error("Invalid calendar month");
  const start = new Date(`${month}-01T00:00:00Z`);
  if (
    Number.isNaN(start.valueOf()) ||
    start.toISOString().slice(0, 7) !== month
  ) {
    throw new Error("Invalid calendar month");
  }
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function shiftMonth(month: string, offset: number) {
  const { start } = monthBounds(month);
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function calendarMonthCells(month: string): Array<string | null> {
  const { start, end } = monthBounds(month);
  const first = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  const leadingEmptyCells = (first.getUTCDay() + 6) % 7;
  const cells: Array<string | null> = Array.from(
    { length: leadingEmptyCells },
    () => null,
  );

  for (let day = 1; day <= last.getUTCDate(); day += 1) {
    const date = new Date(first);
    date.setUTCDate(day);
    cells.push(date.toISOString().slice(0, 10));
  }

  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
