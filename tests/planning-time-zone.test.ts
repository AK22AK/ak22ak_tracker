import { describe, expect, it } from "vitest";

import {
  instantAtLocalNoon,
  localDateInTimeZone,
  reportedUtcOffsetMinutes,
} from "@/domain/planning-time";

describe("fixed tracker planning time zone (P0-09)", () => {
  it("changes the planning date at Shanghai midnight", () => {
    expect(
      localDateInTimeZone("2026-07-18T15:59:59.999Z", "Asia/Shanghai"),
    ).toBe("2026-07-18");
    expect(
      localDateInTimeZone("2026-07-18T16:00:00.000Z", "Asia/Shanghai"),
    ).toBe("2026-07-19");
  });

  it("does not follow the device time zone when deriving the plan date", () => {
    const instant = "2026-07-18T17:00:00.000Z";
    expect(localDateInTimeZone(instant, "Asia/Shanghai")).toBe("2026-07-19");
    expect(localDateInTimeZone(instant, "America/Los_Angeles")).toBe(
      "2026-07-18",
    );
  });

  it("reports JavaScript device offsets using the ISO sign convention", () => {
    expect(reportedUtcOffsetMinutes(-480)).toBe(480);
    expect(reportedUtcOffsetMinutes(420)).toBe(-420);
  });

  it("resolves a target date to a stable instant in the tracker time zone", () => {
    expect(
      instantAtLocalNoon("2026-07-19", "Asia/Shanghai").toISOString(),
    ).toBe("2026-07-19T04:00:00.000Z");
    expect(
      localDateInTimeZone(
        instantAtLocalNoon("2026-11-01", "America/Los_Angeles"),
        "America/Los_Angeles",
      ),
    ).toBe("2026-11-01");
  });
});
