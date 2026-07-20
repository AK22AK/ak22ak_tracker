import { getAuthorizedSession } from "@/server/auth/session";
import { getGitHubMirrorStatus } from "@/server/mirror/runtime";

export async function GET() {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json(await getGitHubMirrorStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
