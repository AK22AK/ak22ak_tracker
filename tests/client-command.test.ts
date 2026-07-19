import { describe, expect, it, vi } from "vitest";

import { createOrReuseClientCommand } from "@/domain/client-command";

function environment() {
  return {
    now: () => new Date("2026-07-18T16:00:00.000Z"),
    randomUUID: vi
      .fn()
      .mockReturnValueOnce("019c0000-0000-7000-8000-000000000001")
      .mockReturnValueOnce("019c0000-0000-7000-8000-000000000002"),
    timeZone: () => "America/Los_Angeles",
    timezoneOffsetMinutes: () => 420,
  };
}

describe("stable client command metadata (P0-03/P0-09)", () => {
  it("reuses the command id while retrying unchanged content", () => {
    const runtime = environment();
    const first = createOrReuseClientCommand(
      null,
      { status: "completed" },
      runtime,
    );
    const retry = createOrReuseClientCommand(
      first,
      { status: "completed" },
      runtime,
    );

    expect(retry).toBe(first);
    expect(runtime.randomUUID).toHaveBeenCalledOnce();
    expect(first.metadata).toMatchObject({
      occurredTimeZone: "America/Los_Angeles",
      occurredUtcOffsetMinutes: -420,
    });
  });

  it("creates a new command when the intended content changes", () => {
    const runtime = environment();
    const first = createOrReuseClientCommand(
      null,
      { status: "completed" },
      runtime,
    );
    const changed = createOrReuseClientCommand(
      first,
      { status: "skipped" },
      runtime,
    );

    expect(changed.metadata.commandId).not.toBe(first.metadata.commandId);
  });
});
