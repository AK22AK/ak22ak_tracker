import "server-only";

import { assertMirrorTargetPath } from "./path";

export type GitHubMirrorErrorCode =
  | "unsafe_target_path"
  | "authentication"
  | "permissions"
  | "repository_access"
  | "rate_limited"
  | "github_unavailable"
  | "timeout"
  | "invalid_response"
  | "conflict";

export class GitHubMirrorError extends Error {
  constructor(
    public readonly code: GitHubMirrorErrorCode,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = "GitHubMirrorError";
  }
}

export type GitHubMirrorConfig = {
  owner: string;
  repo: string;
  branch: string;
  token: string;
};

type ExistingFile = { sha: string; content: string } | null;

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, sortedJsonValue(child)]),
    );
  }
  return value;
}

export function stableJsonDocument(value: unknown): string {
  return `${JSON.stringify(sortedJsonValue(value), null, 2)}\n`;
}

function safeConfigSegment(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value) && !value.includes("..");
}

export function readGitHubMirrorConfig(
  environment: Record<string, string | undefined> = process.env,
): GitHubMirrorConfig | null {
  const owner = environment.GITHUB_DATA_OWNER?.trim();
  const repo = environment.GITHUB_DATA_REPO?.trim();
  const branch = environment.GITHUB_DATA_BRANCH?.trim();
  const token = environment.GITHUB_DATA_TOKEN?.trim();
  if (!owner || !repo || !branch || !token) return null;
  if (
    !safeConfigSegment(owner) ||
    !safeConfigSegment(repo) ||
    !safeConfigSegment(branch)
  ) {
    throw new GitHubMirrorError("invalid_response", false);
  }
  return { owner, repo, branch, token };
}

function classifyResponse(status: number, headers: Headers): GitHubMirrorError {
  if (status === 401) return new GitHubMirrorError("authentication", false);
  if (status === 403) {
    const remaining = headers.get("x-ratelimit-remaining");
    return remaining === "0"
      ? new GitHubMirrorError("rate_limited", true)
      : new GitHubMirrorError("permissions", false);
  }
  if (status === 429) return new GitHubMirrorError("rate_limited", true);
  if (status >= 500) return new GitHubMirrorError("github_unavailable", true);
  if (status === 409 || status === 422) {
    return new GitHubMirrorError("conflict", true);
  }
  return new GitHubMirrorError("invalid_response", false);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function createGitHubContentsMirror(
  config: GitHubMirrorConfig,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    conflictRetries?: number;
  } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const conflictRetries = options.conflictRetries ?? 2;
  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/`;

  async function request(path: string, init?: RequestInit, query = "") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${baseUrl}${path}${query}`, {
        ...init,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${config.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...init?.headers,
        },
      });
    } catch (error) {
      throw isAbortError(error)
        ? new GitHubMirrorError("timeout", true)
        : new GitHubMirrorError("github_unavailable", true);
    } finally {
      clearTimeout(timer);
    }
  }

  async function getExisting(path: string): Promise<ExistingFile> {
    const response = await request(
      path,
      {
        method: "GET",
        headers: { Accept: "application/vnd.github.object+json" },
      },
      `?ref=${encodeURIComponent(config.branch)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw classifyResponse(response.status, response.headers);
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new GitHubMirrorError("invalid_response", false);
    }
    if (
      !value ||
      typeof value !== "object" ||
      (value as Record<string, unknown>).type !== "file" ||
      typeof (value as Record<string, unknown>).sha !== "string" ||
      typeof (value as Record<string, unknown>).content !== "string"
    ) {
      throw new GitHubMirrorError("invalid_response", false);
    }
    return {
      sha: (value as { sha: string }).sha,
      content: Buffer.from(
        (value as { content: string }).content,
        "base64",
      ).toString("utf8"),
    };
  }

  return {
    async putJson(path: string, value: unknown) {
      try {
        assertMirrorTargetPath(path);
      } catch {
        throw new GitHubMirrorError("unsafe_target_path", false);
      }
      const document = stableJsonDocument(value);
      for (let conflictAttempt = 0; ; conflictAttempt += 1) {
        const existing = await getExisting(path);
        if (existing?.content === document) {
          return { outcome: "unchanged" as const, sha: existing.sha };
        }
        const response = await request(path, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: existing
              ? `mirror: update ${path}`
              : `mirror: create ${path}`,
            branch: config.branch,
            content: Buffer.from(document, "utf8").toString("base64"),
            ...(existing ? { sha: existing.sha } : {}),
          }),
        });
        if (
          (response.status === 409 || response.status === 422) &&
          conflictAttempt < conflictRetries
        ) {
          continue;
        }
        if (!response.ok) {
          if (response.status === 404) {
            throw new GitHubMirrorError("repository_access", false);
          }
          throw classifyResponse(response.status, response.headers);
        }
        let result: unknown;
        try {
          result = await response.json();
        } catch {
          throw new GitHubMirrorError("invalid_response", false);
        }
        const sha =
          result &&
          typeof result === "object" &&
          typeof (result as { content?: { sha?: unknown } }).content?.sha ===
            "string"
            ? (result as { content: { sha: string } }).content.sha
            : null;
        if (!sha) throw new GitHubMirrorError("invalid_response", false);
        return {
          outcome: existing ? ("updated" as const) : ("created" as const),
          sha,
        };
      }
    },
  };
}

export type GitHubContentsMirror = ReturnType<
  typeof createGitHubContentsMirror
>;
