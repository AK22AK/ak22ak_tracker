import { afterEach, describe, expect, it, vi } from "vitest";

import { isAllowedGithubId } from "@/server/auth/allowlist";
import { authOptions } from "@/server/auth/options";

afterEach(() => vi.unstubAllEnvs());

describe("GitHub numeric id allowlist (P0-11)", () => {
  it("accepts the configured immutable numeric id", () => {
    expect(isAllowedGithubId(12_345_678, "12345678")).toBe(true);
    expect(isAllowedGithubId("12345678", "12345678")).toBe(true);
  });

  it("rejects a different, malformed, or missing id", () => {
    expect(isAllowedGithubId(1, "12345678")).toBe(false);
    expect(isAllowedGithubId("example-user", "12345678")).toBe(false);
    expect(isAllowedGithubId(undefined, "12345678")).toBe(false);
    expect(isAllowedGithubId(12_345_678, undefined)).toBe(false);
  });

  it("authorizes OAuth profiles by id and carries the id into the session", async () => {
    vi.stubEnv("ALLOWED_GITHUB_ID", "12345678");
    const signIn = authOptions.callbacks?.signIn;
    const session = authOptions.callbacks?.session;
    expect(signIn).toBeTypeOf("function");
    expect(session).toBeTypeOf("function");

    await expect(
      signIn?.({ profile: { id: 12_345_678 } } as never),
    ).resolves.toBe(true);
    await expect(
      signIn?.({ profile: { id: 1, login: "example-user" } } as never),
    ).resolves.toBe(false);

    const migrated = await session?.({
      session: { user: {} },
      token: { sub: "12345678" },
    } as never);
    expect(
      (migrated?.user as { githubId?: string } | undefined)?.githubId,
    ).toBe("12345678");
  });
});
