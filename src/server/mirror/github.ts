import "server-only";

import { Octokit } from "@octokit/rest";

interface GitHubMirrorConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export class GitHubMirrorClient {
  private readonly octokit: Octokit;

  constructor(private readonly config: GitHubMirrorConfig) {
    this.octokit = new Octokit({ auth: config.token });
  }

  async putJson(path: string, value: unknown, message: string): Promise<void> {
    let sha: string | undefined;

    try {
      const existing = await this.octokit.rest.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path,
        ref: this.config.branch,
      });
      if (!Array.isArray(existing.data) && existing.data.type === "file") {
        sha = existing.data.sha;
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        "status" in error &&
        error.status === 404
      )) {
        throw error;
      }
    }

    await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.config.owner,
      repo: this.config.repo,
      branch: this.config.branch,
      path,
      message,
      content: Buffer.from(`${JSON.stringify(value, null, 2)}\n`).toString(
        "base64",
      ),
      sha,
    });
  }
}
