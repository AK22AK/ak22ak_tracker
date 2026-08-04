import { z, ZodError } from "zod";

import { assistantMemoryCategorySchema } from "@/domain/rehab-assistant";
import { getAuthorizedSession } from "@/server/auth/session";
import { getAssistantStore } from "@/server/integrations/assistant/repository";

const updateSchema = z
  .object({
    category: assistantMemoryCategorySchema,
    content: z.string().trim().min(1).max(500),
  })
  .strict();

async function trackerAndMemory(
  params: Promise<{ trackerKey: string; memoryId: string }>,
) {
  const value = await params;
  const assistantStore = getAssistantStore();
  return {
    ...value,
    tracker: await assistantStore.requireTracker(value.trackerKey),
  };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string; memoryId: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const assistantStore = getAssistantStore();
    const input = updateSchema.parse(await request.json());
    const value = await trackerAndMemory(params);
    await assistantStore.updateMemory({
      trackerId: value.tracker.id,
      memoryId: value.memoryId,
      ...input,
      now: new Date(),
    });
    return Response.json(
      await assistantStore.loadConversation(value.trackerKey),
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ZodError ? "invalid_request" : "memory_unavailable",
      },
      { status: error instanceof ZodError ? 400 : 409 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string; memoryId: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const assistantStore = getAssistantStore();
    const value = await trackerAndMemory(params);
    await assistantStore.deleteMemory({
      trackerId: value.tracker.id,
      memoryId: value.memoryId,
      now: new Date(),
    });
    return Response.json(
      await assistantStore.loadConversation(value.trackerKey),
    );
  } catch {
    return Response.json({ error: "memory_unavailable" }, { status: 409 });
  }
}
