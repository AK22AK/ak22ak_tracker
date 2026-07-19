import "server-only";

import { getServerSession } from "next-auth";

import { isAllowedGithubId } from "./allowlist";
import { authOptions } from "./options";

export async function getAuthorizedSession() {
  const session = await getServerSession(authOptions);
  return isAllowedGithubId(
    session?.user?.githubId,
    process.env.ALLOWED_GITHUB_ID,
  )
    ? session
    : null;
}
