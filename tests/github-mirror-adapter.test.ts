// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createGitHubContentsMirror,
  GitHubMirrorError,
  stableJsonDocument,
} from "@/server/mirror/github";

const config = {
  owner: "anonymous-owner",
  repo: "anonymous-data",
  branch: "main",
  token: "anonymous-fake-token",
};
const targetPath =
  "trackers/example-tracker/events/2026/07/019c0000-0000-7000-8000-000000000001.json";
const payload = { zeta: 2, alpha: { second: true, first: 1 } };

function response(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("GitHub Contents mirror adapter", () => {
  it("creates a stable newline-terminated JSON file when the target is absent", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(404, { message: "Not Found" }))
      .mockResolvedValueOnce(response(201, { content: { sha: "new-sha" } }));
    const mirror = createGitHubContentsMirror(config, { fetchImpl });

    await expect(mirror.putJson(targetPath, payload)).resolves.toEqual({
      outcome: "created",
      sha: "new-sha",
    });

    const put = fetchImpl.mock.calls[1];
    expect(put?.[1]?.method).toBe("PUT");
    const body = JSON.parse(String(put?.[1]?.body)) as {
      content: string;
      branch: string;
    };
    expect(Buffer.from(body.content, "base64").toString("utf8")).toBe(
      stableJsonDocument(payload),
    );
    expect(body.branch).toBe("main");
    expect(put?.[1]?.headers).toMatchObject({
      Authorization: "Bearer anonymous-fake-token",
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("?ref=main");
  });

  it("skips an identical file without creating a commit", async () => {
    const content = Buffer.from(stableJsonDocument(payload)).toString("base64");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, { type: "file", sha: "same", content }),
      );
    const mirror = createGitHubContentsMirror(config, { fetchImpl });

    await expect(mirror.putJson(targetPath, payload)).resolves.toEqual({
      outcome: "unchanged",
      sha: "same",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("updates with the current sha and recovers from one sha conflict", async () => {
    const old = Buffer.from("{}\n").toString("base64");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, { type: "file", sha: "old", content: old }),
      )
      .mockResolvedValueOnce(response(409, { message: "conflict" }))
      .mockResolvedValueOnce(
        response(200, { type: "file", sha: "fresh", content: old }),
      )
      .mockResolvedValueOnce(response(200, { content: { sha: "updated" } }));
    const mirror = createGitHubContentsMirror(config, {
      fetchImpl,
      conflictRetries: 1,
    });

    await expect(mirror.putJson(targetPath, payload)).resolves.toEqual({
      outcome: "updated",
      sha: "updated",
    });
    const firstPut = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)) as {
      sha: string;
    };
    const secondPut = JSON.parse(
      String(fetchImpl.mock.calls[3]?.[1]?.body),
    ) as {
      sha: string;
    };
    expect(firstPut.sha).toBe("old");
    expect(secondPut.sha).toBe("fresh");
  });

  it.each([
    [429, "rate_limited", true],
    [503, "github_unavailable", true],
    [401, "authentication", false],
    [403, "permissions", false],
  ] as const)(
    "classifies %s without exposing the provider response",
    async (status, code, retryable) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response(status, { message: "private provider detail" }),
        );
      const mirror = createGitHubContentsMirror(config, { fetchImpl });

      const error = await mirror
        .putJson(targetPath, payload)
        .catch((value: unknown) => value);
      expect(error).toBeInstanceOf(GitHubMirrorError);
      expect(error).toMatchObject({ code, retryable });
      expect(String(error)).not.toContain("private provider detail");
      expect(String(error)).not.toContain(config.token);
    },
  );

  it("classifies a repository access failure on write as terminal", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(404, { message: "Not Found" }))
      .mockResolvedValueOnce(response(404, { message: "Not Found" }));
    const mirror = createGitHubContentsMirror(config, { fetchImpl });
    await expect(mirror.putJson(targetPath, payload)).rejects.toMatchObject({
      code: "repository_access",
      retryable: false,
    });
  });

  it("classifies an aborted provider request as a retryable timeout", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("anonymous timeout", "AbortError"));
    const mirror = createGitHubContentsMirror(config, { fetchImpl });
    await expect(mirror.putJson(targetPath, payload)).rejects.toMatchObject({
      code: "timeout",
      retryable: true,
    });
  });

  it("rejects target path traversal and encoded bypasses before network access", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const mirror = createGitHubContentsMirror(config, { fetchImpl });

    for (const path of [
      "/trackers/example/events/a.json",
      "trackers/example/../secrets.json",
      "trackers/example/%2e%2e/secrets.json",
      "trackers/example\\events\\record.json",
      "other/example/record.json",
      "trackers/example/events/record.txt",
    ]) {
      await expect(mirror.putJson(path, payload)).rejects.toMatchObject({
        code: "unsafe_target_path",
        retryable: false,
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
