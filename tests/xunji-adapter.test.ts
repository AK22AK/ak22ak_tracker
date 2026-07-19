import { describe, expect, it, vi } from "vitest";

import { createXunjiReadOnlyAdapter } from "@/server/integrations/xunji/adapter";
import { normalizeXunjiTrains } from "@/server/integrations/xunji/normalize";

describe("Xunji read-only adapter", () => {
  it("calls only the approved training endpoint and parses res.trains", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          res: {
            trains: [
              {
                localid: "anonymous-train-1",
                title: "Anonymous strength session",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const adapter = createXunjiReadOnlyAdapter({ fetchImpl });

    const trains = await adapter.fetchTrainsForDate({
      apiKey: "anonymous-fake-key",
      date: "2026-07-19",
    });

    expect(trains).toEqual([
      {
        localid: "anonymous-train-1",
        title: "Anonymous strength session",
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://trains.xunjiapp.cn/api_trains_for_llm_v2");
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer anonymous-fake-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(request.body))).toEqual({
      schema_version: "train_open_api_v2",
      datestr: "2026-07-19",
      include_full_data: true,
    });
    expect(url).not.toContain("anonymous-fake-key");
    expect(String(request.body)).not.toContain("anonymous-fake-key");
  });

  it("rejects a response that does not match the approved training schema", async () => {
    const adapter = createXunjiReadOnlyAdapter({
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ res: { meals: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    });

    await expect(
      adapter.fetchTrainsForDate({
        apiKey: "anonymous-fake-key",
        date: "2026-07-19",
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "invalid_response" }));
  });

  it("rejects duplicate provider record ids instead of issuing conflicting writes", async () => {
    const adapter = createXunjiReadOnlyAdapter({
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            res: {
              trains: [
                { localid: "anonymous-train-1" },
                { localid: "anonymous-train-1" },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    });

    await expect(
      adapter.fetchTrainsForDate({
        apiKey: "anonymous-fake-key",
        date: "2026-07-19",
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "invalid_response" }));
  });

  it.each([
    [401, "authentication"],
    [403, "authentication"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
  ] as const)("maps provider status %s to %s", async (status, code) => {
    const adapter = createXunjiReadOnlyAdapter({
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          new Response("provider details must not escape", { status }),
        ),
    });

    await expect(
      adapter.fetchTrainsForDate({
        apiKey: "anonymous-fake-key",
        date: "2026-07-19",
      }),
    ).rejects.toEqual(expect.objectContaining({ code }));
  });

  it("maps an aborted request to a timeout without exposing the key", async () => {
    const fetchImpl = vi.fn(
      (_: RequestInfo | URL, request?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          request?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const adapter = createXunjiReadOnlyAdapter({ fetchImpl, timeoutMs: 1 });

    const error = await adapter
      .fetchTrainsForDate({
        apiKey: "anonymous-fake-key",
        date: "2026-07-19",
      })
      .catch((caught: unknown) => caught);

    expect(error).toEqual(expect.objectContaining({ code: "timeout" }));
    expect(String(error)).not.toContain("anonymous-fake-key");
  });

  it("normalizes stable source ids and detects content changes by hash", () => {
    const fetchedAt = new Date("2026-07-19T08:00:00.000Z");
    const first = normalizeXunjiTrains({
      trains: [{ localid: "anonymous-train-1", title: "Anonymous session" }],
      date: "2026-07-19",
      fetchedAt,
      planningTimeZone: "Asia/Shanghai",
    })[0]!;
    const reordered = normalizeXunjiTrains({
      trains: [{ title: "Anonymous session", localid: "anonymous-train-1" }],
      date: "2026-07-19",
      fetchedAt,
      planningTimeZone: "Asia/Shanghai",
    })[0]!;
    const changed = normalizeXunjiTrains({
      trains: [{ localid: "anonymous-train-1", title: "Updated session" }],
      date: "2026-07-19",
      fetchedAt,
      planningTimeZone: "Asia/Shanghai",
    })[0]!;

    expect(first.providerRecordId).toBe("anonymous-train-1");
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(reordered.contentHash).toBe(first.contentHash);
    expect(changed.contentHash).not.toBe(first.contentHash);
  });
});
