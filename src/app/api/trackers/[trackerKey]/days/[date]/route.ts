import { isLocalDate } from "@/domain/calendar";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  AggregateTrackerNotFoundError,
  getDayAggregate,
} from "@/server/aggregates/tracker";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string; date: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { trackerKey, date } = await params;
  if (!isLocalDate(date)) {
    return Response.json({ error: "invalid_date" }, { status: 400 });
  }
  try {
    return Response.json(await getDayAggregate(trackerKey, date));
  } catch (error) {
    if (error instanceof AggregateTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
