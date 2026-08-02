import "server-only";

import { getServerSession } from "next-auth";

import { isAllowedGithubId } from "./allowlist";
import { authOptions } from "./options";

async function applyBrowserTestAuthDelay() {
  if (process.env.PLAYWRIGHT_TEST !== "1") return;
  const delayMs = Number(process.env.AK_TEST_AUTH_DELAY_MS);
  if (!Number.isInteger(delayMs) || delayMs < 1 || delayMs > 10_000) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function getAuthorizedSession() {
  await applyBrowserTestAuthDelay();
  const session = await getServerSession(authOptions);
  return isAllowedGithubId(
    session?.user?.githubId,
    process.env.ALLOWED_GITHUB_ID,
  )
    ? session
    : null;
}
