import "client-only";

import {
  safetyPolicyReferenceSchema,
  trackerSafetyPolicySchema,
  type SafetyPolicyReference,
  type TrackerSafetyPolicy,
} from "@/domain/safety-policy";

import type { TrackerOfflineDatabase } from "./store";

function policyRowId(input: {
  githubUserId: string;
  trackerKey: string;
  policyId: string;
  version: number;
}) {
  return [
    input.githubUserId,
    input.trackerKey,
    input.policyId,
    input.version,
  ].join(":");
}

export async function saveSafetyPolicy(
  database: TrackerOfflineDatabase,
  input: {
    githubUserId: string;
    trackerKey: string;
    policy: TrackerSafetyPolicy;
    savedAt: string;
    expiresAt: string;
  },
) {
  const policy = trackerSafetyPolicySchema.parse(input.policy);
  if (policy.trackerKey !== input.trackerKey) {
    throw new Error("offline_policy_tracker_mismatch");
  }
  await database.transaction(
    "rw",
    database.metadata,
    database.safetyPolicies,
    async () => {
      const identity = await database.metadata.get("active-identity");
      if (identity?.value !== input.githubUserId) {
        throw new Error("offline_identity_mismatch");
      }
      await database.safetyPolicies.put({
        id: policyRowId({
          githubUserId: input.githubUserId,
          trackerKey: input.trackerKey,
          policyId: policy.policyId,
          version: policy.version,
        }),
        githubUserId: input.githubUserId,
        trackerKey: input.trackerKey,
        policyId: policy.policyId,
        version: policy.version,
        hash: policy.hash,
        savedAt: input.savedAt,
        expiresAt: input.expiresAt,
        data: policy,
      });
    },
  );
}

export async function readSafetyPolicy(
  database: TrackerOfflineDatabase,
  input: {
    githubUserId: string;
    trackerKey: string;
    reference: SafetyPolicyReference;
    now?: Date;
  },
) {
  const reference = safetyPolicyReferenceSchema.parse(input.reference);
  const id = policyRowId({
    githubUserId: input.githubUserId,
    trackerKey: input.trackerKey,
    policyId: reference.policyId,
    version: reference.version,
  });
  const row = await database.safetyPolicies.get(id);
  if (!row) return null;
  const policy = trackerSafetyPolicySchema.safeParse(row.data);
  if (
    row.githubUserId !== input.githubUserId ||
    row.trackerKey !== input.trackerKey ||
    row.hash !== reference.hash ||
    Date.parse(row.expiresAt) <= (input.now ?? new Date()).getTime() ||
    !policy.success ||
    policy.data.hash !== reference.hash
  ) {
    if (
      row.githubUserId !== input.githubUserId ||
      row.trackerKey !== input.trackerKey ||
      Date.parse(row.expiresAt) <= (input.now ?? new Date()).getTime() ||
      !policy.success
    ) {
      await database.safetyPolicies.delete(id);
    }
    return null;
  }
  return policy.data;
}
