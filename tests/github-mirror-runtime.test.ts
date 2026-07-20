// @vitest-environment node

import { describe, expect, it } from "vitest";

import { resolveGitHubMirrorRuntimeConfig } from "@/server/mirror/runtime";

describe("GitHub mirror runtime configuration", () => {
  it("distinguishes missing and invalid server configuration", () => {
    expect(resolveGitHubMirrorRuntimeConfig({})).toMatchObject({
      configuration: "not_configured",
      mirror: null,
    });
    expect(
      resolveGitHubMirrorRuntimeConfig({
        GITHUB_DATA_OWNER: "anonymous-owner",
        GITHUB_DATA_REPO: "../invalid",
        GITHUB_DATA_BRANCH: "main",
        GITHUB_DATA_TOKEN: "anonymous-fake-token",
      }),
    ).toMatchObject({
      configuration: "invalid_configuration",
      mirror: null,
    });
  });

  it("marks a complete anonymous server configuration as configured", () => {
    expect(
      resolveGitHubMirrorRuntimeConfig({
        GITHUB_DATA_OWNER: "anonymous-owner",
        GITHUB_DATA_REPO: "anonymous-data",
        GITHUB_DATA_BRANCH: "main",
        GITHUB_DATA_TOKEN: "anonymous-fake-token",
      }).configuration,
    ).toBe("configured");
  });
});
