import { createGitHubMirrorCronHandler } from "@/server/mirror/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const GET = createGitHubMirrorCronHandler();
