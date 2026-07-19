import { describe, expect, it } from "vitest";

import {
  canonicalSafetyPolicyJson,
  evaluateSafetyPolicy,
  trackerSafetyPolicyDocumentSchema,
  type SafetyRule,
} from "@/domain/safety-policy";

const anonymousRules: SafetyRule[] = [
  {
    id: "anonymous-warning",
    outcome: "yellow",
    match: "all",
    conditions: [
      { operator: "number_gte", field: "score", value: 7 },
      { operator: "equals", field: "ready", value: true },
    ],
  },
  {
    id: "anonymous-stop",
    outcome: "red",
    match: "any",
    conditions: [
      { operator: "equals", field: "status", value: "stop" },
      {
        operator: "max_number_gte",
        fields: ["left", "right"],
        value: 9,
      },
    ],
  },
];

describe("generic tracker safety policy", () => {
  it("evaluates anonymous rules with red taking precedence", () => {
    expect(
      evaluateSafetyPolicy(
        { score: 7, ready: true, status: "ok", left: 0, right: 0 },
        anonymousRules,
      ),
    ).toBe("yellow");
    expect(
      evaluateSafetyPolicy(
        { score: 0, ready: false, status: "stop", left: 0, right: 0 },
        anonymousRules,
      ),
    ).toBe("red");
  });

  it("accepts an immutable anonymous policy document", () => {
    expect(
      trackerSafetyPolicyDocumentSchema.parse({
        schemaVersion: "1.0.0",
        policyId: "019c0000-0000-7000-8000-000000000010",
        trackerKey: "anonymous-tracker",
        version: 1,
        effectiveFrom: "2026-07-19T00:00:00.000Z",
        createdAt: "2026-07-19T00:00:00.000Z",
        createdBy: "import",
        rules: anonymousRules,
      }),
    ).toBeDefined();
  });

  it("canonicalizes object keys without reordering rule arrays", () => {
    expect(canonicalSafetyPolicyJson({ b: 2, a: [{ z: 1, y: 0 }] })).toBe(
      '{"a":[{"y":0,"z":1}],"b":2}',
    );
  });
});
