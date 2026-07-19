import { describe, expect, it } from "vitest";

import {
  evaluateKneeCheckIn,
  type KneeCheckInInput,
} from "@/modules/knee-rehab/check-in";

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
const anonymousPolicy = { painYellowThreshold: 5 };

describe("evaluateKneeCheckIn", () => {
  it("returns green for a low-symptom check-in", () => {
    expect(
      evaluateKneeCheckIn({ ...baseline, leftPain: 4 }, anonymousPolicy),
    ).toBe("green");
  });

  it("returns yellow for pain at the threshold", () => {
    expect(
      evaluateKneeCheckIn({ ...baseline, rightPain: 5 }, anonymousPolicy),
    ).toBe("yellow");
  });

  it("returns yellow for mild swelling", () => {
    expect(
      evaluateKneeCheckIn({ ...baseline, swelling: "mild" }, anonymousPolicy),
    ).toBe("yellow");
  });

  it("returns red when a red-flag symptom is present", () => {
    expect(
      evaluateKneeCheckIn(
        { ...baseline, mechanicalSymptoms: true },
        anonymousPolicy,
      ),
    ).toBe("red");
  });
});
