import { describe, expect, it } from "vitest";

import {
  evaluateKneeCheckIn,
  type KneeCheckInInput,
} from "@/modules/knee-rehab/check-in";
import type { SafetyRule } from "@/domain/safety-policy";

const baseline: KneeCheckInInput = {
  timing: "post_training",
  leftPain: 0,
  rightPain: 0,
  swelling: "none",
  stiffness: false,
  mechanicalSymptoms: false,
  weightBearingIssue: false,
  localizedBonePain: false,
  nightOrRestPain: false,
  note: "",
};
const anonymousRules: SafetyRule[] = [
  {
    id: "anonymous-red-flag",
    outcome: "red",
    match: "any",
    conditions: [
      { operator: "equals", field: "mechanicalSymptoms", value: true },
      { operator: "equals", field: "swelling", value: "obvious" },
    ],
  },
  {
    id: "anonymous-caution",
    outcome: "yellow",
    match: "any",
    conditions: [
      {
        operator: "max_number_gte",
        fields: ["leftPain", "rightPain"],
        value: 5,
      },
      { operator: "equals", field: "swelling", value: "mild" },
    ],
  },
];

describe("evaluateKneeCheckIn", () => {
  it("returns green for a low-symptom check-in", () => {
    expect(
      evaluateKneeCheckIn({ ...baseline, leftPain: 4 }, anonymousRules),
    ).toBe("green");
  });

  it("returns yellow for pain at the threshold", () => {
    expect(
      evaluateKneeCheckIn({ ...baseline, rightPain: 5 }, anonymousRules),
    ).toBe("yellow");
  });

  it("returns yellow for mild swelling", () => {
    expect(
      evaluateKneeCheckIn({ ...baseline, swelling: "mild" }, anonymousRules),
    ).toBe("yellow");
  });

  it("returns red when a red-flag symptom is present", () => {
    expect(
      evaluateKneeCheckIn(
        { ...baseline, mechanicalSymptoms: true },
        anonymousRules,
      ),
    ).toBe("red");
  });
});
