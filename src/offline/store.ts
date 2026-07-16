import "client-only";

import Dexie, { type EntityTable } from "dexie";

import type { PlanVersion, TrackerEvent } from "@/domain/schemas";

export interface PendingEvent {
  id: string;
  event: TrackerEvent;
  queuedAt: string;
  attempts: number;
  lastErrorCode?: string;
}

export interface CachedPlan {
  trackerKey: string;
  plan: PlanVersion;
  cachedAt: string;
}

class TrackerOfflineDatabase extends Dexie {
  pendingEvents!: EntityTable<PendingEvent, "id">;
  cachedPlans!: EntityTable<CachedPlan, "trackerKey">;

  constructor() {
    super("ak22ak-tracker");
    this.version(1).stores({
      pendingEvents: "id, queuedAt",
      cachedPlans: "trackerKey, cachedAt",
    });
  }
}

export const offlineDatabase = new TrackerOfflineDatabase();
