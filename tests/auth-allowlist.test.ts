import { describe, expect, it } from "vitest";

import { isAllowedGithubLogin } from "@/server/auth/allowlist";

describe("GitHub login allowlist", () => {
  it("accepts the configured account without case sensitivity", () => {
    expect(isAllowedGithubLogin("AK22AK", "ak22ak")).toBe(true);
  });

  it("rejects a different or missing account", () => {
    expect(isAllowedGithubLogin("another-user", "AK22AK")).toBe(false);
    expect(isAllowedGithubLogin(undefined, "AK22AK")).toBe(false);
    expect(isAllowedGithubLogin("AK22AK", undefined)).toBe(false);
  });
});
