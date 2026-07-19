import { z } from "zod";

import { instantSchema, schemaVersion, trackerKeySchema } from "./schemas";

const policyFieldSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/);

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

export const safetyConditionSchema = z.discriminatedUnion("operator", [
  z.object({
    operator: z.literal("equals"),
    field: policyFieldSchema,
    value: scalarSchema,
  }),
  z.object({
    operator: z.literal("number_gte"),
    field: policyFieldSchema,
    value: z.number(),
  }),
  z.object({
    operator: z.literal("max_number_gte"),
    fields: z.array(policyFieldSchema).min(1).max(20),
    value: z.number(),
  }),
]);

export const safetyRuleSchema = z.object({
  id: z.string().min(1).max(120),
  outcome: z.enum(["yellow", "red"]),
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(safetyConditionSchema).min(1).max(50),
});

export const trackerSafetyPolicyDocumentSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  policyId: z.uuid(),
  trackerKey: trackerKeySchema,
  version: z.number().int().positive(),
  effectiveFrom: instantSchema,
  createdAt: instantSchema,
  createdBy: z.enum(["import", "user"]),
  rules: z.array(safetyRuleSchema).min(1).max(200),
});

export const trackerSafetyPolicySchema =
  trackerSafetyPolicyDocumentSchema.extend({
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  });

export const safetyPolicyReferenceSchema = z.object({
  policyId: z.uuid(),
  version: z.number().int().positive(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type SafetyLevel = "green" | "yellow" | "red";
export type SafetyCondition = z.infer<typeof safetyConditionSchema>;
export type SafetyRule = z.infer<typeof safetyRuleSchema>;
export type TrackerSafetyPolicyDocument = z.infer<
  typeof trackerSafetyPolicyDocumentSchema
>;
export type TrackerSafetyPolicy = z.infer<typeof trackerSafetyPolicySchema>;
export type SafetyPolicyReference = z.infer<typeof safetyPolicyReferenceSchema>;

export function canonicalSafetyPolicyJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSafetyPolicyJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, child]) =>
          `${JSON.stringify(key)}:${canonicalSafetyPolicyJson(child)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function valueAtPath(input: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((value, segment) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, input);
}

function conditionMatches(
  input: Record<string, unknown>,
  condition: SafetyCondition,
): boolean {
  switch (condition.operator) {
    case "equals":
      return valueAtPath(input, condition.field) === condition.value;
    case "number_gte": {
      const value = valueAtPath(input, condition.field);
      return typeof value === "number" && value >= condition.value;
    }
    case "max_number_gte": {
      const values = condition.fields.map((field) => valueAtPath(input, field));
      return (
        values.every((value) => typeof value === "number") &&
        Math.max(...(values as number[])) >= condition.value
      );
    }
  }
}

function ruleMatches(
  input: Record<string, unknown>,
  rule: SafetyRule,
): boolean {
  const matches = rule.conditions.map((condition) =>
    conditionMatches(input, condition),
  );
  return rule.match === "any" ? matches.some(Boolean) : matches.every(Boolean);
}

export function evaluateSafetyPolicy(
  input: Record<string, unknown>,
  rules: readonly SafetyRule[],
): SafetyLevel {
  let outcome: SafetyLevel = "green";
  for (const rule of rules) {
    if (!ruleMatches(input, rule)) continue;
    if (rule.outcome === "red") return "red";
    outcome = "yellow";
  }
  return outcome;
}

export function safetyPolicyReference(
  policy: TrackerSafetyPolicy,
): SafetyPolicyReference {
  return {
    policyId: policy.policyId,
    version: policy.version,
    hash: policy.hash,
  };
}
