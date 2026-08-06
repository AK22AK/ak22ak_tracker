import { describe, expect, it } from "vitest";

import {
  canonicalCooldownDeadline,
  cooldownFromDeadline,
} from "@/server/integrations/core/provider-cooldown";

const serverNow = new Date("2026-08-06T00:00:00.000Z");
const validDeadlines: Array<Date | string> = [
  new Date("2026-08-06T00:00:30.000Z"),
  "2026-08-06T00:00:30.000Z",
];
const invalidDeadlines: Array<unknown> = [
  new Date("invalid"),
  "not-a-timestamp",
  "",
];

describe("provider cooldown timestamps", () => {
  it.each(validDeadlines)(
    "calculates a finite remaining duration for %s",
    (retryAvailableAt) => {
      const cooldown = cooldownFromDeadline({
        kind: "normal",
        retryAvailableAt,
        serverNow,
      });

      expect(cooldown.retryAfterMs).toBe(30_000);
      expect(cooldown.retryAvailableAt).toEqual(
        new Date("2026-08-06T00:00:30.000Z"),
      );
    },
  );

  it.each(invalidDeadlines)(
    "rejects an invalid deadline: %s",
    (retryAvailableAt) => {
      expect(() =>
        cooldownFromDeadline({
          kind: "normal",
          retryAvailableAt: retryAvailableAt as Date | string,
          serverNow,
        }),
      ).toThrow(/provider_cooldown_retry_available_at_invalid/);
    },
  );

  it("rejects an invalid server timestamp", () => {
    expect(() =>
      cooldownFromDeadline({
        kind: "normal",
        retryAvailableAt: "2026-08-06T00:00:30.000Z",
        serverNow: "not-a-timestamp",
      }),
    ).toThrow(/provider_cooldown_server_now_invalid/);
  });

  it("rejects a non-finite Provider retry duration", () => {
    expect(() =>
      canonicalCooldownDeadline({
        now: serverNow,
        providerRetryAfterMs: Number.NaN,
      }),
    ).toThrow(/provider_cooldown_retry_after_invalid/);
  });
});
