import { getAuthorizedSession } from "@/server/auth/session";
import { syncGitHubMirrorBatch } from "@/server/mirror/runtime";

export async function POST() {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json(await syncGitHubMirrorBatch(), {
    headers: { "Cache-Control": "no-store" },
  });
}
