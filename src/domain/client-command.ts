import type { z } from "zod";

import { clientCommandMetadataSchema } from "./schemas";
import { reportedUtcOffsetMinutes } from "./planning-time";

export type ClientCommandMetadata = z.infer<typeof clientCommandMetadataSchema>;

export type PendingClientCommand = {
  fingerprint: string;
  metadata: ClientCommandMetadata;
};

type CommandEnvironment = {
  now(): Date;
  randomUUID(): string;
  timeZone(): string;
  timezoneOffsetMinutes(date: Date): number;
};

const browserEnvironment: CommandEnvironment = {
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  timezoneOffsetMinutes: (date) => date.getTimezoneOffset(),
};

export function createOrReuseClientCommand(
  pending: PendingClientCommand | null,
  payload: unknown,
  environment: CommandEnvironment = browserEnvironment,
): PendingClientCommand {
  const fingerprint = JSON.stringify(payload);
  if (pending?.fingerprint === fingerprint) {
    return pending;
  }

  const now = environment.now();
  return {
    fingerprint,
    metadata: clientCommandMetadataSchema.parse({
      commandId: environment.randomUUID(),
      occurredAt: now.toISOString(),
      occurredTimeZone: environment.timeZone(),
      occurredUtcOffsetMinutes: reportedUtcOffsetMinutes(
        environment.timezoneOffsetMinutes(now),
      ),
    }),
  };
}
