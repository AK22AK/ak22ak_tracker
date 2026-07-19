import { monthBounds } from "@/domain/calendar";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  AggregateTrackerNotFoundError,
  getCalendarAggregate,
} from "@/server/aggregates/tracker";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const month = new URL(request.url).searchParams.get("month");
  try {
    if (!month) throw new Error("invalid_month");
    monthBounds(month);
    return Response.json(
      await getCalendarAggregate((await params).trackerKey, month),
    );
  } catch (error) {
    if (error instanceof AggregateTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && error.message === "Invalid calendar month") {
      return Response.json({ error: "invalid_month" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "invalid_month") {
      return Response.json({ error: "invalid_month" }, { status: 400 });
    }
    throw error;
  }
}
