import "server-only";

import { and, desc, eq, lte } from "drizzle-orm";

import {
  trackerSafetyPolicySchema,
  type TrackerSafetyPolicy,
} from "@/domain/safety-policy";

import { getDatabase } from "../db/client";
import { trackerSafetyPolicies, trackers } from "../db/schema";

export class TrackerSafetyPolicyNotFoundError extends Error {
  constructor() {
    super("tracker_safety_policy_not_found");
    this.name = "TrackerSafetyPolicyNotFoundError";
  }
}

export async function getEffectiveTrackerSafetyPolicy(
  trackerKey: string,
  targetTime: Date,
): Promise<TrackerSafetyPolicy> {
  const [tracker] = await getDatabase()
    .select({ id: trackers.id })
    .from(trackers)
    .where(and(eq(trackers.key, trackerKey), eq(trackers.active, true)))
    .limit(1);
  if (!tracker) throw new TrackerSafetyPolicyNotFoundError();
  return getEffectiveTrackerSafetyPolicyByTrackerId(tracker.id, targetTime);
}

export async function getEffectiveTrackerSafetyPolicyByTrackerId(
  trackerId: string,
  targetTime: Date,
): Promise<TrackerSafetyPolicy> {
  const [row] = await getDatabase()
    .select({
      policyId: trackerSafetyPolicies.id,
      version: trackerSafetyPolicies.version,
      hash: trackerSafetyPolicies.hash,
      document: trackerSafetyPolicies.document,
    })
    .from(trackerSafetyPolicies)
    .where(
      and(
        eq(trackerSafetyPolicies.trackerId, trackerId),
        lte(trackerSafetyPolicies.effectiveFrom, targetTime),
      ),
    )
    .orderBy(
      desc(trackerSafetyPolicies.effectiveFrom),
      desc(trackerSafetyPolicies.version),
    )
    .limit(1);

  if (!row) throw new TrackerSafetyPolicyNotFoundError();

  return trackerSafetyPolicySchema.parse({
    ...row.document,
    policyId: row.policyId,
    version: row.version,
    hash: row.hash,
  });
}
