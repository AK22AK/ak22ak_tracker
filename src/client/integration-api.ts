import { githubMirrorStatusSchema } from "@/domain/github-mirror";
import {
  garminConnectionStatusSchema,
  garminWellnessProgressSchema,
} from "@/domain/garmin";
import {
  integrationStatusSchema,
  providerHistoryOverviewSchema,
} from "@/domain/integrations";
import { deepSeekConnectionStatusSchema } from "@/domain/deepseek";
import { todaySyncResultSchema } from "@/domain/today-sync";

async function getJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`request_failed_${response.status}`);
  return response.json();
}

export async function fetchIntegrationStatus(
  trackerKey: string,
  provider: string,
  signal?: AbortSignal,
) {
  return integrationStatusSchema.parse(
    await getJson(
      `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/${encodeURIComponent(provider)}/credential`,
      signal,
    ),
  );
}

export async function fetchGitHubMirrorStatus(signal?: AbortSignal) {
  return githubMirrorStatusSchema.parse(
    await getJson("/api/mirror/status", signal),
  );
}

export async function fetchGarminConnectionStatus(
  trackerKey: string,
  signal?: AbortSignal,
) {
  return garminConnectionStatusSchema.parse(
    await getJson(
      `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/garmin/credential`,
      signal,
    ),
  );
}

export async function fetchGarminWellnessProgress(
  trackerKey: string,
  signal?: AbortSignal,
) {
  return garminWellnessProgressSchema.parse(
    await getJson(
      `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/garmin/wellness`,
      signal,
    ),
  );
}

export async function fetchDeepSeekConnectionStatus(
  trackerKey: string,
  signal?: AbortSignal,
) {
  return deepSeekConnectionStatusSchema.parse(
    await getJson(
      `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/deepseek/credential`,
      signal,
    ),
  );
}

export async function fetchProviderHistoryOverview(
  trackerKey: string,
  signal?: AbortSignal,
) {
  return providerHistoryOverviewSchema.parse(
    await getJson(
      `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/history-sync`,
      signal,
    ),
  );
}

export async function syncLatestIntegrationRecords(trackerKey: string) {
  const response = await fetch(
    `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/sync-latest`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) throw new Error("latest_sync_unavailable");
  return todaySyncResultSchema.parse(await response.json());
}
