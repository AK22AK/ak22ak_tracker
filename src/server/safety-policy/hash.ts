import "server-only";

import { createHash } from "node:crypto";

import {
  canonicalSafetyPolicyJson,
  type TrackerSafetyPolicyDocument,
} from "@/domain/safety-policy";

export function hashSafetyPolicy(
  document: TrackerSafetyPolicyDocument,
): string {
  return createHash("sha256")
    .update(canonicalSafetyPolicyJson(document))
    .digest("hex");
}
