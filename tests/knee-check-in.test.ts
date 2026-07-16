import { describe, expect, it } from "vitest";

import {
  evaluateKneeCheckIn,
  type KneeCheckInInput,
} from "@/modules/knee-rehab/check-in";

const baseline: KneeCheckInInput = {
  localDate: "2026-07-18",
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

describe("evaluateKneeCheckIn", () => {
  it("returns green for a low-symptom check-in", () => {
    expect(evaluateKneeCheckIn({ ...baseline, leftPain: 2 })).toBe("green");
  });

  it("returns yellow for pain at the threshold", () => {
    expect(evaluateKneeCheckIn({ ...baseline, rightPain: 3 })).toBe("yellow");
  });

  it("returns yellow for mild swelling", () => {
    expect(evaluateKneeCheckIn({ ...baseline, swelling: "mild" })).toBe(
      "yellow",
    );
  });

  it("returns red when a red-flag symptom is present", () => {
    expect(evaluateKneeCheckIn({ ...baseline, mechanicalSymptoms: true })).toBe(
      "red",
    );
  });
});
