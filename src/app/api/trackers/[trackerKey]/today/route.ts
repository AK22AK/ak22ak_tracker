import { ZodError } from "zod";

import { isLocalDate } from "@/domain/calendar";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  AggregateTrackerNotFoundError,
  getTodayAggregate,
} from "@/server/aggregates/tracker";
import { TrackerSafetyPolicyNotFoundError } from "@/server/safety-policy/repository";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const targetDate = new URL(request.url).searchParams.get("date");
  if (!isLocalDate(targetDate)) {
    return Response.json({ error: "invalid_date" }, { status: 400 });
  }

  try {
    return Response.json(
      await getTodayAggregate((await params).trackerKey, targetDate),
    );
  } catch (error) {
    if (error instanceof AggregateTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof TrackerSafetyPolicyNotFoundError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_aggregate" }, { status: 500 });
    }
    throw error;
  }
}
