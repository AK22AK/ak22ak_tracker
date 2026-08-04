import { ZodError } from "zod";

import { rehabProfileDocumentSchema } from "@/domain/rehab-assistant";
import { getAuthorizedSession } from "@/server/auth/session";
import { getAssistantStore } from "@/server/integrations/assistant/repository";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { trackerKey } = await params;
  const assistantStore = getAssistantStore();
  const page = await assistantStore.loadConversation(trackerKey);
  return Response.json(page.profile, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const assistantStore = getAssistantStore();
    const document = rehabProfileDocumentSchema.parse(await request.json());
    const tracker = await assistantStore.requireTracker(
      (await params).trackerKey,
    );
    await assistantStore.saveActiveProfile({
      trackerId: tracker.id,
      document,
      now: new Date(),
    });
    return Response.json(
      (await assistantStore.loadConversation((await params).trackerKey))
        .profile,
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    return Response.json({ error: "profile_unavailable" }, { status: 503 });
  }
}
