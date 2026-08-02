import { describe, expect, it } from "vitest";

import { parsePlanImportArguments } from "@/domain/plan-import";

describe("plan import arguments", () => {
  it("accepts an explicit audited tracker start date", () => {
    expect(
      parsePlanImportArguments([
        "--",
        "private-plan.json",
        "--tracker-started-on",
        "2031-04-07",
      ]),
    ).toEqual({
      planPath: "private-plan.json",
      trackerStartedOn: "2031-04-07",
    });
  });

  it.each([
    ["missing value", ["private-plan.json", "--tracker-started-on"]],
    [
      "invalid date",
      ["private-plan.json", "--tracker-started-on", "2026-02-30"],
    ],
    ["unknown option", ["private-plan.json", "--replace-history"]],
    ["duplicate plan", ["one.json", "two.json"]],
  ])("rejects %s", (_label, arguments_) => {
    expect(() => parsePlanImportArguments(arguments_)).toThrow();
  });
});
