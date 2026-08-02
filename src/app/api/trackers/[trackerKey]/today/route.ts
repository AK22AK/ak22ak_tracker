import { ZodError } from "zod";

import { isLocalDate } from "@/domain/calendar";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  AggregateTrackerNotFoundError,
  getTodayAggregate,
} from "@/server/aggregates/tracker";
import { TrackerSafetyPolicyNotFoundError } from "@/server/safety-policy/repository";

function startupTiming(
  startedAt: number,
  authFinishedAt: number,
  todayFinishedAt = authFinishedAt,
) {
  const duration = (from: number, to: number) =>
    Math.max(0, to - from).toFixed(1);
  return [
    `ak_auth;dur=${duration(startedAt, authFinishedAt)}`,
    `ak_today;dur=${duration(authFinishedAt, todayFinishedAt)}`,
    `ak_total;dur=${duration(startedAt, todayFinishedAt)}`,
  ].join(", ");
}

function timedJson(
  body: unknown,
  status: number,
  startedAt: number,
  authFinishedAt: number,
  todayFinishedAt = authFinishedAt,
) {
  return Response.json(body, {
    status,
    headers: {
      "Server-Timing": startupTiming(
        startedAt,
        authFinishedAt,
        todayFinishedAt,
      ),
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  const startedAt = performance.now();
  const session = await getAuthorizedSession();
  const authFinishedAt = performance.now();
  if (!session) {
    return timedJson({ error: "unauthorized" }, 401, startedAt, authFinishedAt);
  }
  const targetDate = new URL(request.url).searchParams.get("date");
  if (!isLocalDate(targetDate)) {
    return timedJson({ error: "invalid_date" }, 400, startedAt, authFinishedAt);
  }

  try {
    const aggregate = await getTodayAggregate(
      (await params).trackerKey,
      targetDate,
    );
    return timedJson(
      aggregate,
      200,
      startedAt,
      authFinishedAt,
      performance.now(),
    );
  } catch (error) {
    const todayFinishedAt = performance.now();
    if (error instanceof AggregateTrackerNotFoundError) {
      return timedJson(
        { error: error.message },
        404,
        startedAt,
        authFinishedAt,
        todayFinishedAt,
      );
    }
    if (error instanceof TrackerSafetyPolicyNotFoundError) {
      return timedJson(
        { error: error.message },
        503,
        startedAt,
        authFinishedAt,
        todayFinishedAt,
      );
    }
    if (error instanceof ZodError) {
      return timedJson(
        { error: "invalid_aggregate" },
        500,
        startedAt,
        authFinishedAt,
        todayFinishedAt,
      );
    }
    throw error;
  }
}
