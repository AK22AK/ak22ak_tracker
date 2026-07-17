import { describe, expect, it } from "vitest";

import {
  calendarMonthCells,
  isLocalDate,
  monthBounds,
  shiftMonth,
} from "@/domain/calendar";

describe("calendar dates", () => {
  it("builds a Monday-first month grid", () => {
    const cells = calendarMonthCells("2026-07");
    expect(cells.slice(0, 3)).toEqual([null, null, "2026-07-01"]);
    expect(cells).toHaveLength(35);
    expect(cells.filter(Boolean).at(-1)).toBe("2026-07-31");
  });

  it("handles month boundaries", () => {
    expect(monthBounds("2026-02")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("rejects impossible local dates", () => {
    expect(isLocalDate("2026-07-17")).toBe(true);
    expect(isLocalDate("2026-02-30")).toBe(false);
  });
});
