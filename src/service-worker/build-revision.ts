import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function runGit(args: string[]) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeCommit(value: string) {
  return /^[0-9a-f]{7,64}$/i.test(value) ? value.toLowerCase() : "";
}

export function resolveServiceWorkerBuildRevision() {
  const commit =
    safeCommit(process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "") ||
    safeCommit(runGit(["rev-parse", "HEAD"]));
  const diffDigest = digest(
    runGit(["diff", "--no-ext-diff", "--binary", "HEAD"]),
  );

  if (commit) return `ak-r10-${commit.slice(0, 12)}-${diffDigest.slice(0, 8)}`;

  const packageManifest = readFileSync(
    resolve(process.cwd(), "package.json"),
    "utf8",
  );
  return `ak-r10-${digest(`${packageManifest}:${diffDigest}`).slice(0, 20)}`;
}
