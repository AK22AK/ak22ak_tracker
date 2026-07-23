import { githubMirrorStatusSchema } from "@/domain/github-mirror";
import { integrationStatusSchema } from "@/domain/integrations";

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
